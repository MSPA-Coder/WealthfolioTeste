# Wealthfolio 3.9.1 com os patches deste repositório, sem nenhuma pasta fora do Git.
#
# Até 03/10/2026 o compose.yaml construía ../CodexTemp/wealthfolio-v3.9.1, uma
# cópia do upstream com os patches aplicados à mão e mais uma extensão que não
# estava versionada em lugar nenhum (hoje o patch 0000). Perder o VPS era
# perder a única forma de reconstruir a imagem que roda. Aqui o código vem do
# commit fixado da tag, os patches de `patches/` entram na ordem do nome, e o
# resto repete o Dockerfile do upstream na v3.9.1, com as imagens-base fixadas
# por digest. Upstream + 0000..0003 foi conferido igual, arquivo a arquivo, ao
# CodexTemp que estava em produção.
#
# Para subir de versão: troque WEALTHFOLIO_COMMIT pelo commit da tag nova,
# confira que os patches ainda aplicam e compare as etapas abaixo com o
# Dockerfile do upstream nessa tag.

# Tag v3.9.1 (objeto da tag: fa3cd85717ed47f448bcbd637e222c11234f9094).
ARG WEALTHFOLIO_COMMIT=392f272c5b15a4af45dc2ff71dcbec474f47112a

# Fonte: upstream no commit fixado + patches, ou o build para.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8 AS fonte
RUN apk add --no-cache git
ARG WEALTHFOLIO_COMMIT
RUN git init -q /src \
 && git -C /src fetch -q --depth 1 https://github.com/wealthfolio/wealthfolio "$WEALTHFOLIO_COMMIT" \
 && git -C /src checkout -q --detach FETCH_HEAD \
 && test "$(git -C /src rev-parse HEAD)" = "$WEALTHFOLIO_COMMIT"
COPY patches/ /patches/
# `git apply` sem tolerância de espaço: patch que não casa exato é patch que
# precisa ser refeito, não ajustado em silêncio.
RUN cd /src \
 && for patch in /patches/*.patch; do echo "aplicando $patch"; git apply "$patch"; done \
 && rm -rf .git

# Front-end (Dockerfile do upstream, estágio 1).
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS frontend
# Wealthfolio Connect desligado, como no build sem argumentos do upstream. As
# duas variáveis existem vazias (e não ausentes) porque o servidor as lê na
# compilação, onde vazia e ausente não são a mesma coisa.
ARG CONNECT_AUTH_URL=
ARG CONNECT_AUTH_PUBLISHABLE_KEY=
ENV CONNECT_AUTH_URL=${CONNECT_AUTH_URL}
ENV CONNECT_AUTH_PUBLISHABLE_KEY=${CONNECT_AUTH_PUBLISHABLE_KEY}
WORKDIR /app
COPY --from=fonte /src/ ./
ENV CI=1
ENV BUILD_TARGET=web
RUN npm install -g pnpm@9.9.0 && pnpm install --frozen-lockfile
RUN pnpm --filter frontend... build && mv dist /web-dist

# Servidor (Dockerfile do upstream, estágio 2).
FROM --platform=$BUILDPLATFORM tonistiigi/xx:1.7.0@sha256:010d4b66aed389848b0694f91c7aaee9df59a6f20be7f5d12e53663a37bd14e2 AS xx

FROM --platform=$BUILDPLATFORM rust:1.98.1-alpine@sha256:7cc1c22d77d9432f7fe012a70e6d3e555af54c2a6832700ed7d553f1769ae89f AS backend
COPY --from=xx / /
ARG TARGETPLATFORM
# Wealthfolio Connect desligado, como no build sem argumentos do upstream. As
# duas variáveis existem vazias (e não ausentes) porque o servidor as lê na
# compilação, onde vazia e ausente não são a mesma coisa.
ARG CONNECT_AUTH_URL=
ARG CONNECT_AUTH_PUBLISHABLE_KEY=
ENV CONNECT_AUTH_URL=${CONNECT_AUTH_URL}
ENV CONNECT_AUTH_PUBLISHABLE_KEY=${CONNECT_AUTH_PUBLISHABLE_KEY}
WORKDIR /app
RUN apk add --no-cache clang lld build-base git file pkgconfig perl
RUN xx-apk add --no-cache musl-dev gcc openssl-dev openssl-libs-static sqlite-dev
RUN rustup target add $(xx-cargo --print-target-triple)

# Dependências numa camada própria, como no upstream.
COPY --from=fonte /src/Cargo.toml /src/Cargo.lock ./
COPY --from=fonte /src/crates ./crates
COPY --from=fonte /src/apps/server ./apps/server
COPY --from=fonte /src/apps/tauri/Cargo.toml apps/tauri/Cargo.toml
RUN mkdir -p apps/tauri/src && echo "fn main(){}" > apps/tauri/src/main.rs && echo "" > apps/tauri/src/lib.rs
RUN mkdir -p apps/server/src && \
    echo "fn main(){}" > apps/server/src/main.rs && \
    xx-cargo fetch --locked --manifest-path apps/server/Cargo.toml

COPY --from=fonte /src/crates ./crates
COPY --from=fonte /src/apps/server ./apps/server
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse
ENV OPENSSL_STATIC=1
RUN xx-cargo build --locked --release --manifest-path apps/server/Cargo.toml && \
    cp target/$(xx-cargo --print-target-triple)/release/wealthfolio-server /wealthfolio-server

# Testes do upstream nos dois módulos que os patches mexem, com o mesmo
# toolchain do build. Fora da imagem: a CI roda `docker build --target testes .`.
FROM backend AS testes
# Os testes do upstream incluem, na compilação, arquivos de fora dos crates: as
# fixtures de contabilidade (`tests/fixtures`) e o `index.html` do front-end. A
# imagem final não os leva, então só este estágio os copia.
COPY --from=fonte /src/tests ./tests
COPY --from=fonte /src/apps/frontend/index.html ./apps/frontend/index.html
RUN xx-cargo test --locked --release -p wealthfolio-core --lib addons::network \
 && xx-cargo test --locked --release -p wealthfolio-server --lib patrimonio_sync

# Imagem final (Dockerfile do upstream, estágio 3). A base fica a mesma do
# upstream, alpine:3.19, para a imagem não mudar além da origem do código.
FROM alpine:3.19@sha256:6baf43584bcb78f2e5847d1de515f23499913ac9f12bdf834811a3145eb11ca1
WORKDIR /app
COPY --from=backend /wealthfolio-server /usr/local/bin/wealthfolio-server
COPY --from=frontend /web-dist ./dist
ENV WF_DB_PATH=/data/wealthfolio.db
ARG CONNECT_API_URL=
ENV CONNECT_API_URL=${CONNECT_API_URL}
RUN addgroup -S -g 1000 wealthfolio \
 && adduser -S -u 1000 -G wealthfolio -H -s /sbin/nologin wealthfolio \
 && mkdir -p /data \
 && chown -R wealthfolio:wealthfolio /data
USER 1000:1000

VOLUME ["/data"]
EXPOSE 8088
CMD ["/usr/local/bin/wealthfolio-server"]
