let isEmpty = require('lodash/isEmpty');

let required = (field: any) => (input: any) => !isEmpty(input) ? true : `The field "${field}" is required.`;

module.exports = required;
