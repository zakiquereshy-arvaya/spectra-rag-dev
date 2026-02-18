-- Ops Dashboard schema for Supabase
-- Tables: ops_events, ops_agent_reports, ops_rag_metrics

-- ============================================================
-- 1. ops_events – tracks every meaningful user action
-- ============================================================
CREATE TABLE IF NOT EXISTS ops_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_email TEXT,
    user_name TEXT,
    event_type TEXT NOT NULL,       -- page_view, chat_message, tool_call, api_request, time_entry, booking, rag_query
    event_action TEXT,              -- send_message, book_meeting, submit_time_entry, etc.
    route TEXT,                     -- /moe, /appointments, /rag/ask, etc.
    metadata JSONB DEFAULT '{}',   -- extra context (tool name, session ID, model, etc.)
    duration_ms INTEGER             -- how long the action took (nullable)
);

CREATE INDEX IF NOT EXISTS idx_ops_events_timestamp ON ops_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_user_email ON ops_events (user_email);
CREATE INDEX IF NOT EXISTS idx_ops_events_event_type ON ops_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ops_events_route ON ops_events (route);

-- ============================================================
-- 2. ops_agent_reports – autonomous DevOps agent assessments
-- ============================================================
CREATE TABLE IF NOT EXISTS ops_agent_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    health_score INTEGER,           -- 0-100
    summary TEXT,
    report JSONB NOT NULL DEFAULT '{}',
    triggered_by TEXT               -- email of person who triggered the report
);

CREATE INDEX IF NOT EXISTS idx_ops_agent_reports_created ON ops_agent_reports (created_at DESC);

-- ============================================================
-- 3. ops_rag_metrics – per-query RAG pipeline performance
-- ============================================================
CREATE TABLE IF NOT EXISTS ops_rag_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    query TEXT,
    user_email TEXT,
    -- Timing breakdown (milliseconds)
    embed_ms INTEGER,
    dense_ms INTEGER,
    sparse_ms INTEGER,
    rerank_ms INTEGER,
    total_ms INTEGER,
    -- Candidate counts at each stage
    dense_count INTEGER,
    sparse_count INTEGER,
    fused_count INTEGER,
    reranked_count INTEGER,
    final_count INTEGER,
    -- Rerank score stats
    avg_rerank_score REAL,
    max_rerank_score REAL,
    min_rerank_score REAL,
    -- Context
    context_token_estimate INTEGER,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ops_rag_metrics_timestamp ON ops_rag_metrics (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ops_rag_metrics_user ON ops_rag_metrics (user_email);
