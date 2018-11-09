let isEmpty = require('lodash/isEmpty');

let required = (field) => (input) => !isEmpty(input) ? true : `The field "${field}" is required.`;

module.exports = required;