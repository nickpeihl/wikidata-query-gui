FROM node:alpine as builder

WORKDIR /usr/src/app

COPY . .

RUN apk add --no-cache git \
    && npm install \
    && npm run build

FROM nginx:alpine

WORKDIR /usr/share/nginx/html
COPY --from=builder /usr/src/app/build .
