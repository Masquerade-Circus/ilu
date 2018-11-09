# ilu

ilu 1.0.0 - Ilu - Cli tools for productivity

---
## Roadmap
- [X] Todos
- [X] Simple notes
- [ ] Translator
- [ ] World clock
- [ ] Kanban boards
- [ ] Callendar and remainders


## COMMAND `ilu`

USAGE

     ilu <command> [options]

COMMANDS

     todo                Manage Todo tasks for the current active list
     todo-list           Manage Todo lists
     note                Manage Notes for the current active list
     note-list           Manage Note Lists
     help <command>      Display help for a specific command

GLOBAL OPTIONS

     -h, --help         Display help
     -V, --version      Display version
     --no-color         Disable colors
     --quiet            Quiet mode - only displays warn and error messages
     -v, --verbose      Verbose mode - will also output debug messages

## COMMAND `ilu todo`

USAGE

     ilu todo
     ilu t

OPTIONS

     -a, --add                     Add a new task
     -d, --details <position>      Show details  of the task at <position>
     -e, --edit <position>         Edit the task at <position>
     -s, --show                    Show all tasks
     -c, --check                   Check/uncheck finished tasks
     -r, --remove [position]       Remove the task at [position], if no position, remove all tasks

## COMMAND `ilu todo-list`

 USAGE

     ilu todo-list 
     ilu tl

   OPTIONS

     -a, --add                          Add new list                                                             
     -d, --details <position>           Show details of the list at <position>                                   
     -e, --edit <position>              Edit the list at <position>                                              
     -s, --show                         Show all lists                                                           
     -u, --use <position>               Use the list at <position>                                               
     -r, --remove [position]            Remove the list at [position], if no position, remove all the lists      
     -c, --current                      Show the details of the current list                                     
     -A, --add-label                    Add new label to the current list                                        
     -E, --edit-label <position>        Edit the label at <position>                                             
     -R, --remove-label [position]      Remove the label at [position], if no position, remove all labels   

## COMMAND `ilu note`

USAGE

     ilu note 
     ilu n

   OPTIONS

     -a, --add                     Add a new note                                                           
     -d, --details <position>      Show details of the note at <postion>                                    
     -e, --edit <position>         Edit the note at <position>                                              
     -s, --show                    Show all notes                                                           
     -r, --remove [position]       Remove the note at [position], if no position, remove all the notes   

## COMMAND `ilu note-list`

USAGE

     ilu note-list 
     ilu nl

   OPTIONS

     -a, --add                          Add new list                                                             
     -d, --details <position>           Show details of the list at <position>                                   
     -e, --edit <position>              Edit the list at <position>                                              
     -s, --show                         Show all lists                                                           
     -u, --use <position>               Use the list at <position>                                               
     -r, --remove [position]            Remove the list at [position], if no position, remove all the lists      
     -c, --current                      Show the details of the current list                                     
     -A, --add-label                    Add new label to the current list                                        
     -E, --edit-label <position>        Edit the label at <position>                                             
     -R, --remove-label [position]      Remove the label at [position], if no position, remove all labels   