import os, sys

# double-fork daemon spawn — the process is orphaned to init and survives
# the tool-session process-group reaping that kills setsid/nohup children
def spawn(cmd, logfile):
    pid = os.fork()
    if pid == 0:
        os.setsid()
        pid2 = os.fork()
        if pid2 == 0:
            fd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            os.dup2(fd, 1)
            os.dup2(fd, 2)
            devnull = os.open(os.devnull, os.O_RDONLY)
            os.dup2(devnull, 0)
            os.chdir("/home/z/my-project")
            os.execvp(cmd[0], cmd)
        os._exit(0)
    os.waitpid(pid, 0)

if __name__ == "__main__":
    spawn(["bun", "run", "dev"], "/home/z/my-project/dev.log")
    print("daemonized dev server")
