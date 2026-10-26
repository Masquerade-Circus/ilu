import { assertRepoTempHome } from '../../support/home-sandbox.ts';

assertRepoTempHome(process.env.HOME, 'Clock writer HOME');
const {default: Ui} = await import('../../ui/app.tsx');
const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}});

process.on('message', async (message: {type: string; name?: string}) => {
  try {
    if (message.type === 'close') {
      await session.destroy();
      process.disconnect();
      return;
    }
    if (message.type === 'prepare') {
      session.dispatchKey('ESCAPE');
      session.click('clock-add-open');
      session.focus('clock-add-name');
      session.dispatchText(message.name);
      session.focus('clock-add-timezone-search');
      session.dispatchText('utc');
      session.focus('clock-add-timezone-choices');
      session.dispatchKey('ENTER');
      process.send({type: 'prepared'});
      return;
    }
    if (message.type === 'save') {
      session.click('clock-add-save');
      const state = session.state().clocksState;
      process.send({type: 'saved', accepted: state.overlay === null, error: state.addClock.error});
    }
  } catch (error) {
    process.send({type: 'error', message: error instanceof Error ? error.message : String(error)});
  }
});
process.send({type: 'ready'});
