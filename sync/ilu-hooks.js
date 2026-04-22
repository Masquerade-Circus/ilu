let {notifyLocalMutation} = require('./index');

module.exports = function notifySync(context) {
    Promise.resolve()
        .then(() => notifyLocalMutation(context))
        .catch(() => null);
};
