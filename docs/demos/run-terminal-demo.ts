import { createHeadlessSession } from "../../ui/app.tsx";

const mode = process.argv[2];
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (mode !== "board" && mode !== "workflow") {
  throw new Error('Choose the "board" or "workflow" capture mode.');
}

const session = await createHeadlessSession({
  cols: 108,
  rows: 28,
  state:
    mode === "board"
      ? {
          activeTab: "Board",
          selectedCard: { columnIndex: 1, position: 1 },
          selectedColumnIndex: 1
        }
      : {
          activeTab: "Todo",
          selectedTaskPosition: 1
        }
});

function render(): void {
  const frame = session
    .output()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\r\n");
  process.stdout.write(`\u001b[2J\u001b[H\u001b[38;2;217;224;238m${frame}\u001b[39m`);
}

try {
  if (mode === "board") {
    session.focus("board-card-list-1");
    render();
    await sleep(2000);
  } else {
    session.focus("todo-items");
    render();
    await sleep(1200);

    session.dispatchKey("DOWN");
    render();
    await sleep(600);

    session.dispatchKey("ENTER");
    render();
    await sleep(1000);

    session.dispatchKey("CTRL_3");
    render();
    await sleep(1200);

    session.dispatchKey("SPACE");
    render();
    await sleep(600);

    session.dispatchKey("o");
    render();
    await sleep(1300);

    session.dispatchKey("ESCAPE");
    render();
    await sleep(900);

    session.dispatchKey("CTRL_1");
    render();
    await sleep(1500);
  }
} finally {
  await session.destroy();
}
