-- Nenhuma linha ativa repete arquivo antes deste índice: POST /api/referencias e a semente da casa salvam cada imagem
-- com uma chave nova (crypto.randomUUID), e guardar uma imagem do pedido só chega com este índice.
CREATE UNIQUE INDEX "referencias_arquivo_ativa" ON "referencias" USING btree ("arquivo") WHERE "referencias"."removida_em" is null;
