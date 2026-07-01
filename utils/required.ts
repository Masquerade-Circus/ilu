import isEmpty from 'lodash/isEmpty.js';
let required = (field: string) => (input: unknown) => !isEmpty(input) ? true : `The field "${field}" is required.`;

export default required;
