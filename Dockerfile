FROM node:10.11-alpine AS builder
WORKDIR /app
COPY . /app/
RUN apk add --no-cache git bash && \
    npm install && \
    npm run build

#
# Create the actual production image
#
FROM nginx:latest
LABEL maintainer='Yuri Astrakhan <YuriAstrakhan@gmail.com>'
COPY --from=builder /app/build /usr/share/nginx/html
