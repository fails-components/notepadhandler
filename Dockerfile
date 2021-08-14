FROM node:14

ARG ENV
ARG GITHUB_TOKEN

WORKDIR /usr/src/notepadhandler

COPY package*.json ./
COPY .npmrc ./

#debug
RUN if [ "$ENV" = "debug" ] ; then npm install ; else  npm ci --only=production; fi

COPY . .

EXPOSE 8080

CMD [ "node", "src/server.js" ]
