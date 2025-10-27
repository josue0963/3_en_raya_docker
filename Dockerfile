# Imagen base con servidor web
FROM nginx:latest
 
# Copiar los archivos del juego al servidor Nginx
# El punto (.) significa "todos los archivos en esta carpeta"
COPY . /usr/share/nginx/html
 
# Exponer el puerto 80 (el puerto por defecto de Nginx)
EXPOSE 80