import querystring from 'querystring';

import { createRemoteFileNode } from 'gatsby-source-filesystem';

const uuidv4 = require(`uuid/v4`);
const path = require(`path`);
const fs = require(`fs-extra`);
const { buildSchema, printSchema } = require(`gatsby/graphql`);
const {
  transformSchema,
  introspectSchema,
  RenameTypes,
} = require(`graphql-tools`);
const { createHttpLink } = require(`apollo-link-http`);
const nodeFetch = require(`node-fetch`);
const invariant = require(`invariant`);
const { createDataloaderLink } = require(`./batching/dataloader-link`);
const { downloadThrillworksAsset } = require(`./download-asset`);

const {
  NamespaceUnderFieldTransform,
  StripNonQueryTransform,
} = require(`./transforms`);

exports.setFieldsOnGraphQLNodeType = require(`./extend-node-type`).extendNodeType;

exports.onPreInit = () => console.log('Loaded tw-oleh-gatsby-source-graphql');
/*
exports.onCreateNode = async ({
  node,
  actions,
  store,
  cache,
  createNodeId,
}) => {
  const { createNode, createNodeField } = actions;
  console.log(node.internal.type);
};
*/
exports.sourceNodes = async (
  {
    actions,
    getNodes,
    createNodeId,
    cache,
    createContentDigest,
    store,
    getCache,
    reporter,
  },
  options,
) => {
  const { addThirdPartySchema, createNode } = actions;
  const {
    url,
    typeName,
    fieldName,
    headers = {},
    fetch = nodeFetch,
    fetchOptions = {},
    createLink,
    downloadAssets,
    createSchema,
    refetchInterval,
    batch = false,
  } = options;

  invariant(
    typeName && typeName.length > 0,
    `tw-oleh-gatsby-source-graphql requires option \`typeName\` to be specified`,
  );
  invariant(
    fieldName && fieldName.length > 0,
    `tw-oleh-gatsby-source-graphql requires option \`fieldName\` to be specified`,
  );
  invariant(
    (url && url.length > 0) || createLink,
    `tw-oleh-gatsby-source-graphql requires either option \`url\` or \`createLink\` callback`,
  );

  let link;
  if (createLink) {
    link = await createLink(options);
  } else {
    const options = {
      uri: url,
      downloadAssets,
      fetch,
      fetchOptions,
      headers: typeof headers === `function` ? await headers() : headers,
    };
    link = batch ? createDataloaderLink(options) : createHttpLink(options);
  }

  let introspectionSchema;

  if (createSchema) {
    introspectionSchema = await createSchema(options);
  } else {
    const cacheKey = `tw-oleh-gatsby-source-graphql-schema-${typeName}-${fieldName}`;
    let sdl = await cache.get(cacheKey);

    if (!sdl) {
      introspectionSchema = await introspectSchema(link);
      sdl = printSchema(introspectionSchema);
    } else {
      introspectionSchema = buildSchema(sdl);
    }

    await cache.set(cacheKey, sdl);
  }

  const nodeId = createNodeId(`tw-oleh-gatsby-source-graphql-${typeName}`);
  const node = createSchemaNode({
    id: nodeId,
    typeName,
    fieldName,
    createContentDigest,
  });
  createNode(node);

  const resolver = (parent, args, context) => {
    context.nodeModel.createPageDependency({
      path: context.path,
      nodeId,
    });
    return {};
  };

  const schema = transformSchema(
    {
      schema: introspectionSchema,
      link,
    },
    [
      new StripNonQueryTransform(),
      new RenameTypes(name => `${typeName}_${name}`),
      new NamespaceUnderFieldTransform({
        typeName,
        fieldName,
        resolver,
      }),
    ],
  );

  addThirdPartySchema({ schema });

  if (process.env.NODE_ENV !== `production`) {
    if (refetchInterval) {
      const msRefetchInterval = refetchInterval * 1000;
      const refetcher = () => {
        createNode(
          createSchemaNode({
            id: nodeId,
            typeName,
            fieldName,
            createContentDigest,
          }),
        );
        setTimeout(refetcher, msRefetchInterval);
      };
      setTimeout(refetcher, msRefetchInterval);
    }
  }
  if (downloadAssets) {
    await downloadThrillworksAsset({
      actions,
      createNodeId,
      store,
      cache,
      getCache,
      getNodes,
      reporter,
    });
  }
};

function createSchemaNode({ id, typeName, fieldName, createContentDigest }) {
  const nodeContent = uuidv4();
  const nodeContentDigest = createContentDigest(nodeContent);
  return {
    id,
    typeName,
    fieldName,
    parent: null,
    children: [],
    internal: {
      type: `ThrillworksGQLSource`,
      contentDigest: nodeContentDigest,
      ignoreType: true,
    },
  };
}

// Check if there are any ThrillworkAsset nodes and if gatsby-image is installed. If so,
// add fragments for ThrillworkAsset and gatsby-image. The fragment will cause an error
// if there's not ThrillworkAsset nodes and without gatsby-image, the fragment is useless.
exports.onPreExtractQueries = async ({ store, getNodesByType }) => {
  const { program } = store.getState();

  const CACHE_DIR = path.resolve(
    `${program.directory}/.cache/thrillworks/assets/`,
  );
  await fs.ensureDir(CACHE_DIR);
};

exports.createResolvers = (
  { actions, cache, createNodeId, createResolvers, store, reporter },
  { sharpKeys = [/image|photo|picture|file/] },
) => {
  const { createNode } = actions;

  const state = store.getState();
  const [schema = {}] = state.schemaCustomization.thirdPartySchemas;
  const typeMap = schema._typeMap;
  const resolvers = {};

  Object.keys(typeMap).forEach(typeName => {
    const typeEntry = typeMap[typeName];
    const typeFields =
      (typeEntry && typeEntry.getFields && typeEntry.getFields()) || {};
    const typeResolver = {};

    Object.keys(typeFields).forEach(fieldName => {
      const field = typeFields[fieldName];
      if (
        field.type &&
        String(field.type).includes('prodigyapi') &&
        sharpKeys.some(re =>
          re instanceof RegExp ? re.test(fieldName) : re === fieldName,
        )
      ) {
        // console.log(field);
        typeResolver[`${fieldName}Sharp`] = {
          type: 'File',
          resolve(source) {
            const obj = (source && source[fieldName]) || {};
            const { url } = obj;
            if (url) {
              return createRemoteFileNode({
                url: querystring.unescape(url),
                store,
                cache,
                createNode,
                createNodeId,
                reporter,
              });
            }
            return null;
          },
        };
      }
    });
    // console.log(Object.keys(typeResolver));
    if (Object.keys(typeResolver).length) {
      resolvers[typeName] = typeResolver;
    }
  });
  // console.log(resolvers);
  if (Object.keys(resolvers).length) {
    createResolvers(resolvers);
  }
};
