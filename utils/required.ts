import isEmpty from 'lodash/isEmpty.js';
let required = (field: any) => (input: any) => !isEmpty(input) ? true : `The field "${field}" is required.`;

export default required;
