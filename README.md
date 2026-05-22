# 🕹️ RetroBrinquedos BR

> Reviva a magia da infância. Um museu digital dos brinquedos brasileiros inesquecíveis dos anos 80 e 90.

🔗 **[retro-brinquedos.vercel.app](https://retro-brinquedos.vercel.app)**

---

## Sobre o projeto

O RetroBrinquedos BR é uma SPA (Single Page Application) de preservação da memória cultural, catalogando brinquedos brasileiros das décadas de 1980 e 1990 no formato das lendárias cartas Super Trunfo. Projeto independente, sem fins lucrativos, feito por amor à nostalgia.

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS3, Tailwind CSS |
| Banco de dados | Supabase (PostgreSQL + Auth + RLS) |
| Hospedagem | Vercel |
| Imagens | Cloudinary |
| Fontes | Google Fonts (Orbitron, Inter, Archivo Black) |

---

## Funcionalidades

- 🃏 Catálogo em cards Super Trunfo com flip 3D para ficha técnica
- 🔍 Busca em tempo real com botão de busca forçada
- ♾️ Scroll infinito com motor Masonry assíncrono
- 💬 Drawer de comentários com modo espia para visitantes
- ❤️ Interações por usuário (curtidas, "tive", "queria ter")
- 🎮 Login social via Google e X com avatares arcade personalizáveis
- 📱 Layout responsivo mobile-first
- 📡 Painel LED Matrix com mensagens animadas
- 💡 Sugestão de brinquedos pela comunidade
- 🏭 Modais com história dos principais fabricantes da época

---

## Estrutura

```
/
├── index.html       # SPA principal
├── app.js           # Lógica da aplicação (~2300 linhas)
├── styles.css       # Estilos (~2500 linhas)
├── privacy.html     # Política de Privacidade (LGPD)
├── terms.html       # Termos de Serviço
└── img/             # Assets locais (avatares, logos, coins)
```

---

## Conformidade

Este projeto segue as diretrizes da **Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018)**. As imagens de brinquedos são exibidas com finalidade exclusivamente documental e educativa. Para solicitações de remoção de conteúdo: **mendes79@gmail.com**

---

*Feito com 🕹️ e muita nostalgia.*
