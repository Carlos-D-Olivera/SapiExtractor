# ------------------------------------------------------------------------------
# Stage 1: Compilar Frontend React (Vite + Tailwind)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend

COPY sp-extractor-wails/frontend/package*.json ./
RUN npm ci

COPY sp-extractor-wails/frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Compilar Backend Go (Servidor Web REST)
# ------------------------------------------------------------------------------
FROM golang:1.24-alpine AS backend-builder
WORKDIR /build/backend

ENV CGO_ENABLED=0
ENV GOOS=linux

COPY sp-extractor-wails/go.mod ./
RUN go mod download

# Copiar únicamente los paquetes requeridos por el servidor web
COPY sp-extractor-wails/pkg/ ./pkg/
COPY sp-extractor-wails/cmd/ ./cmd/

# Reemplazar el dist embebido con el generado por Vite
COPY --from=frontend-builder /build/frontend/dist ./cmd/web/dist

# Compilar binario 100% estático
RUN go build -ldflags="-s -w" -o /spextractor-web ./cmd/web

# ------------------------------------------------------------------------------
# Stage 3: Imagen final ligera (Alpine Linux)
# ------------------------------------------------------------------------------
FROM alpine:3.21

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app
COPY --from=backend-builder /spextractor-web /app/spextractor-web

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/app/spextractor-web"]
