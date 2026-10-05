#!/bin/sh
set -e
# Les dossiers montés depuis l'hôte appartiennent souvent à root :
# on corrige les droits puis on lance l'app avec l'utilisateur non privilégié "node".
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data /backups
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
