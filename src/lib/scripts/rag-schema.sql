-- RAG schema for documents and chunks (pgvector + full-text)
-- Requires extensions: vector, pg_trgm (optional)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT,
    source_type TEXT,
    external_url TEXT,
    version TEXT,
    product TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    doc_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    section TEXT,
    order_index INTEGER,
    content TEXT,
    embedding vector(1024),
    tsv_content tsvector GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED,
    language TEXT,
    version TEXT,
    product TEXT,
    tenant_id TEXT,
    updated_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_chunks_tsv
    ON chunks USING GIN (tsv_content);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks (doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_id ON chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_product ON chunks (product);
CREATE INDEX IF NOT EXISTS idx_chunks_version ON chunks (version);
CREATE INDEX IF NOT EXISTS idx_chunks_updated_at ON chunks (updated_at);
