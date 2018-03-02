import {OperationHelper} from 'apac';
import nodeUrl from 'url';
import _ from 'lodash';

import config from './../config';

const client_ca = new OperationHelper({
  awsId: config.awsAccessKeyId,
  awsSecret: config.awsSecretAccessKey,
  assocId: config.awsTagCA,
  maxRequestsPerSecond: 1,
  locale: 'CA'
});
const client_us = new OperationHelper({
  awsId: config.awsAccessKeyId,
  awsSecret: config.awsSecretAccessKey,
  assocId: config.awsTagUS,
  maxRequestsPerSecond: 1,
  locale: 'US'
});
const supportedCountryURLs = [
  'amazon.com',
  'amazon.ca'
];

function isSupportedCountry(url) {
  return !!_.find(supportedCountryURLs, function (supportedUrl) {
    return url.includes(supportedUrl);
  });
}

function isUnSupportedProduct(productResults) {
  let format = _.get(productResults, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Format');
  return format && format.toLowerCase() === 'kindle ebook';
}

function getClient(url) {
  if (url.includes('amazon.com')) {
    return client_us;
  } else if (url.includes('amazon.ca')) {
    return client_ca;
  }
}

function getStore(url) {
  if (url.includes('amazon.com')) {
    return 'amazon.com';
  } else if (url.includes('amazon.ca')) {
    return 'amazon.ca';
  }
}

function getProduct(asin, client) {
  return client.execute('ItemLookup', {
    IdType: 'ASIN',
    ItemId: asin,
    ResponseGroup: 'Images, ItemAttributes, OfferFull'
  });
}

function extractAsin(url) {
  let parsedUrl = nodeUrl.parse(decodeURIComponent(url));

  if (parsedUrl != null && parsedUrl.hostname != null && parsedUrl.hostname.includes("amazon")) {
    let paths = parsedUrl.pathname.split('/');
    let index = _.indexOf(paths, 'product') === -1 ? _.indexOf(paths, 'dp') : _.indexOf(paths, 'product');

    return index !== -1 ? paths[index + 1] : '';
  }

  return '';
}

module.exports = {
  isSupportedCountry: isSupportedCountry,
  isUnSupportedProduct: isUnSupportedProduct,
  getClient: getClient,
  getStore: getStore,
  getProduct: getProduct,
  extractAsin: extractAsin
};
