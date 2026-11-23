CREATE TABLE "pecas_prontas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arquivo" text NOT NULL,
	"formato" text NOT NULL,
	"texto" text NOT NULL,
	"tema" text NOT NULL,
	"pilar" text NOT NULL,
	"legenda" text,
	"criada_por" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"removida_em" timestamp with time zone
);
