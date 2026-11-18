CREATE TABLE "artes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido" text NOT NULL,
	"formato" text NOT NULL,
	"cena" text NOT NULL,
	"prompt_da_cena" text NOT NULL,
	"referencias" uuid[] NOT NULL,
	"camadas" jsonb NOT NULL,
	"criada_por" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arquivo" text NOT NULL,
	"leitura" text NOT NULL,
	"leitura_editada_por" text,
	"criada_por" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"removida_em" timestamp with time zone
);
