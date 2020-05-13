"use strict";

const ProgressBar = require(`progress`);

const {
  createRemoteFileNode
} = require(`gatsby-source-filesystem`);

const bar = new ProgressBar(`Downloading Thrillworks Assets [:bar] :current/:total :elapsed secs :percent`, {
  total: 0,
  width: 30
});
let totalJobs = 0;
/**
 * @name downloadThrillworksAsset
 * @description Downloads Thrillworks assets to the local filesystem.
 * The asset files will be downloaded and cached. Use `localFile` to link to them
 * @param gatsbyFunctions - Gatsby's internal helper functions
 */

const downloadThrillworksAsset = async gatsbyFunctions => {
  const {
    actions: {
      createNode,
      touchNode
    },
    createNodeId,
    store,
    cache,
    getCache,
    getNodes,
    reporter
  } = gatsbyFunctions; // console.log('get nodes for downloading', getNodes());
  // Any ContentfulAsset nodes will be downloaded, cached and copied to public/static
  // regardless of if you use `localFile` to link an asset or not.

  const thrillworksAssetNodes = getNodes().filter(n => n.internal.owner === `tw-oleh-gatsby-source-graphql`); // console.log(thrillworksAssetNodes);

  await Promise.all(thrillworksAssetNodes.map(async node => {
    totalJobs += 1;
    bar.total = totalJobs;
    let fileNodeID;
    const {
      contentful_id: id,
      node_locale: locale
    } = node;
    const remoteDataCacheKey = `thrillworks-asset-${id}-${locale}`;
    const cacheRemoteData = await cache.get(remoteDataCacheKey);

    if (!node.file) {
      reporter.warn(`The asset with id: ${id}, contains no file.`);
      return Promise.resolve();
    }

    if (!node.file.url) {
      reporter.warn(`The asset with id: ${id} has a file but the file contains no url.`);
      return Promise.resolve();
    }

    const url = `http://${node.file.url.slice(2)}`; // Avoid downloading the asset again if it's been cached
    // Note: Contentful Assets do not provide useful metadata
    // to compare a modified asset to a cached version?

    if (cacheRemoteData) {
      fileNodeID = cacheRemoteData.fileNodeID; // eslint-disable-line prefer-destructuring

      touchNode({
        nodeId: cacheRemoteData.fileNodeID
      });
    } // If we don't have cached data, download the file


    if (!fileNodeID) {
      try {
        const fileNode = await createRemoteFileNode({
          url,
          store,
          cache,
          createNode,
          createNodeId,
          getCache,
          reporter
        });

        if (fileNode) {
          bar.tick();
          fileNodeID = fileNode.id;
          await cache.set(remoteDataCacheKey, {
            fileNodeID
          });
        }
      } catch (err) {// Ignore
      }
    }

    if (fileNodeID) {
      node.localFile___NODE = fileNodeID;
    }

    return node;
  }));
};

exports.downloadThrillworksAsset = downloadThrillworksAsset;