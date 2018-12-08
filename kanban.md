|                     |            |              |                  |           |
|---------------------|------------|--------------|------------------|-----------|
| Backlog(n)          | Ready(2)   | Specify(2)   | In Progress(5)   | Done(n)   |
| ------------        | ---------- | ------------ | ---------------- | --------- |
| 1 Title [i] [t] [p] | 9          | 11           | 13               | 18        |
| 2                   | 10         | 12           | 14               | 19        |
| 3                   |            |              | 15               | 20        |
| 4                   |            |              | 16               | 21        |
| 5                   |            |              | 17               | 22        |
| 6                   |            |              |                  | 23        |
| 7                   |            |              |                  | 24        |
| 8                   |            |              |                  | 25        |

Board {
    title
    description
}

Column {
    title
    size
    position,
    board
}

Card {
    title 
    description
    importance
    time
    priority // update on every change based on importance and time
    dependsOn
    tasks: [],
    events [
        {
            type // Push or Return
        }
    ],
    column,
    board,
    position
}

/**
 * opus kanban board -a         Add a board
 * opus kanban board -d [p]     Show details of the board at position, if no position show the details of the current board
 * opus kanban board -s         Show boards
 * opus kanban board -u <p>     Use the board at position
 * opus kanban board -r [p]     Remove the board at position, if no position remove all boards
 * opus kanban board -A         Add a label
 * opus kanban board -R [p]     Remove label at position, if no position remove all labels
 *
 * opus kanban column -a        Add a column
 * opus kanban column -o        Order columns
 * opus kanban column -r [p]    Remove the column at position, if no position remove all columns
 *
 * opus kanban card -a          Add a card
 * opus kanban card -f <p>      Move forward a card at position
 * opus kanban card -b <p>      Move backward a card at position
 * opus kanban card -d <p>      Show details of the card at position
 * opus kanban card -r [c] [p]  Remove the card at column and position, if no position remove all cards for column, if no column remove all cards
 * opus kanban card -o <c>      Order the cards at column
 * opus kanban card -O [c]      Automatically order cards at column, if no column automatically order all cards
 */
