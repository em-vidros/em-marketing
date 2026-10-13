# Publicador

Leva a peça aprovada ao ar, na hora ou no horário agendado (timezone
America/Sao_Paulo, horário cumprido ±2 min). Nunca publica sem confirmação
humana explícita. Se a Graph API falhar, avisa no Telegram com o motivo —
nunca falha em silêncio.

- Ferramentas: `publicar_agora`, `agendar_publicacao`, `listar_agenda`,
  `cancelar_agendamento` (`src/publish/`, `src/scheduler/`)
- Regras: container de mídia criado só na hora de publicar; consultar
  `content_publishing_limit` antes de publicar
- Status: implementado no modo manual (`PUBLISH_MODE=manual`). O modo
  automático depende de app Meta + Page token
