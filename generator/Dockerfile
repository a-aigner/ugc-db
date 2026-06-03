FROM node:20-alpine

# Higgsfield CLI is distributed as an npm package: @higgsfield/cli
# Install globally so it's on PATH for the worker.
RUN apk add --no-cache curl python3 \
 && npm install -g @higgsfield/cli 2>/dev/null || \
    echo "NOTE: @higgsfield/cli install failed — running in mock mode is fine; install the CLI manually inside the container later"

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Tiny PNG used in mock mode (1x1 transparent pixel)
RUN node -e "const fs=require('fs');const buf=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63fcffff3f030007fd02fd9ebfeacc0000000049454e44ae426082','hex');fs.writeFileSync('/app/placeholder.png',buf);"

# Higgsfield CLI persists auth in this directory; mount as a volume to keep it across rebuilds.
RUN mkdir -p /root/.higgsfield

EXPOSE 3200
CMD ["node", "server.js"]
