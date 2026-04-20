const {spawn} = require('node:child_process');

function resolveLaunchCommand(file, {app, platform = process.platform} = {}) {
  if (platform === 'darwin') {
    return {
      command: 'open',
      args: ['-W', '-a', app, file]
    };
  }

  return {
    command: app,
    args: [file]
  };
}

function openWithEditor(file, {app, spawnImpl = spawn, platform = process.platform} = {}) {
  return new Promise((resolve, reject) => {
    const launch = resolveLaunchCommand(file, {app, platform});
    const child = spawnImpl(launch.command, launch.args, {stdio: 'inherit'});

    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Editor process exited with code ${code}`));
    });
  });
}

module.exports = openWithEditor;
