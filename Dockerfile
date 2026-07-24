FROM node:22.20-bookworm-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV DATABASE_URL=sqlite:/var/lib/viral-field/viral-field.db

WORKDIR /app
COPY . .

RUN mkdir -p /var/lib/viral-field

EXPOSE 4173
VOLUME ["/var/lib/viral-field"]

CMD ["npm", "start"]
