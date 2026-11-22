# Aurora Keys 🎹

Aprenda piano com **notas caindo** até as teclas, direto no navegador: conecte seu teclado MIDI, escolha uma música (ou importe seus próprios arquivos `.mid`) e toque junto.

## Como abrir

Abra o `index.html` no **Google Chrome** ou no **Microsoft Edge** (eles suportam Web MIDI). Também funciona publicado no GitHub Pages (Settings → Pages → branch).

Para rodar localmente com um servidor:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Instalar no celular (como aplicativo)

O Aurora Keys é um PWA: depois de publicado num endereço `https://` (por exemplo no GitHub Pages), ele pode ser instalado e abre em tela cheia, com ícone próprio e funcionando sem internet.

- **Android (Chrome):** toque em **Instalar app** no topo da página, ou menu ⋮ → *Instalar app*. Teclado MIDI funciona via cabo USB-OTG.
- **iPhone/iPad (Safari):** Compartilhar → *Adicionar à Tela de Início*. A Apple não libera MIDI para apps da web, então no iOS dá para tocar pela tela e ouvir as músicas.

### Publicar no GitHub Pages

No repositório: **Settings → Pages → Build and deployment → Deploy from a branch**, escolha a branch e a pasta `/ (root)`. O endereço será `https://<usuario>.github.io/<repositorio>/`.

## Recursos

- **Teclado MIDI** via Web MIDI: detecção automática, escolha de entrada, pedal de sustentação e saída MIDI opcional (para a música tocar no som do seu piano digital).
- **Três modos**: *Ouvir* (assistir), *Praticar* (a música espera você acertar cada nota) e *Tocar* (tempo real, com pontuação, combos e estrelas).
- **Mão esquerda, direita ou ambas**, com as faixas de cada arquivo atribuídas automaticamente (e ajustáveis).
- **Importe suas músicas**: botão "Importar MIDI" ou arraste arquivos `.mid`/`.midi` para a página. Elas ficam salvas no navegador (IndexedDB).
- Controle de velocidade, repetição de trecho A–B, linha do tempo com densidade de notas, recordes por música.
- Nomes das notas em **Dó Ré Mi** ou **C D E**, teclado ajustado à música ou com 88 teclas.
- Sem teclado MIDI? Use o teclado do computador (`Z`…`M` e `Q`…`U`, `[` `]` mudam a oitava) ou toque na tela.
- Modo **Tocar livre** com notas subindo enquanto você toca.
- **Partituras**: busca unificada em acervos livres, com download (veja abaixo).
- **Palco 3D**: aponte a câmera para o teclado e veja as notas subirem em 3D das teclas de verdade (veja abaixo).

## Palco 3D: realidade aumentada no seu teclado

A aba **Palco 3D** (ou `#palco3d` no endereço) usa a câmera do celular ou do computador:

1. Escolha o **modelo do teclado** (Yamaha, Casio, Roland, Kawai, Korg, Alesis, Nord, controladores MIDI…) ou informe o número de teclas e a nota mais grave.
2. O app **escaneia** a imagem procurando o padrão das teclas pretas, encaixa o modelo e marca os 4 cantos. Se precisar, arraste os pontos (tem lupa para ajuste fino).
3. Com os cantos, ele calcula a **posição da câmera em 3D** (homografia, com a distância focal estimada pelo próprio retângulo) e desenha a cena com Three.js por cima do vídeo.
4. Cada nota tocada (MIDI, teclado do computador, toque na tela ou botão **Demo**) acende a tecla e solta uma **coluna de luz que sobe flutuando**, com o nome da nota e faíscas.

Ajustes: *Perspectiva* (se as colunas não ficarem retas), *−8ª/+8ª* e *Tecla mais grave* (aperte a primeira tecla do seu teclado MIDI e o app descobre a extensão). A calibração fica salva no navegador. A câmera precisa de `https://` (GitHub Pages serve) e as imagens não saem do aparelho. O celular deve ficar parado num suporte: o app não segue a câmera se ela se mexer (é só tocar em *Ajustar* ou *Escanear* de novo).

O Three.js (MIT) vem junto em `js/vendor/` e só é carregado quando a câmera abre.

## Partituras: uma busca, vários acervos

A aba **Partituras** (ou `#partituras` no endereço) pesquisa ao mesmo tempo em:

| Fonte | O que tem | Como é consultada |
|---|---|---|
| [Mutopia Project](https://www.mutopiaproject.org/) | ~2.100 peças em PDF, MIDI e LilyPond | índice local `data/mutopia.json` |
| [IMSLP](https://imslp.org/) | a maior biblioteca de partituras de domínio público | API do MediaWiki (JSONP), ao vivo |
| [CPDL](https://www.cpdl.org/) | música coral | API do MediaWiki (CORS), ao vivo |
| [Internet Archive](https://archive.org/) | partituras digitalizadas | API de busca e metadados, ao vivo |

Os downloads saem sempre da fonte original. Só entram acervos de domínio público ou com licença livre. Sites com partituras protegidas por direitos autorais ficam de fora.

As peças de piano/cravo do Mutopia que têm MIDI (~790) vêm junto com o app em `assets/mutopia/`. Assim o botão **Praticar** abre a peça direto nas notas caindo e ela é salva em *Minhas músicas*. São arquivos originais, sem modificação, redistribuídos conforme a licença de cada obra; os créditos estão em `assets/mutopia/CREDITS.md`.

### Ver a partitura escrita

O botão **Ver partitura** abre as páginas da partitura como imagem, sem sair do app:

- **Mutopia, peças de piano (775):** todas as páginas, incluídas no app em `assets/mutopia/pages/<id>/` (PNG leve em 4 tons de cinza, ~58 MB no total). Elas também aparecem no player, no botão de partitura, num painel em cima enquanto as notas caem.
- **Mutopia, demais peças:** imagem de prévia (início da peça) + PDF completo.
- **Internet Archive:** todas as páginas digitalizadas (só itens abertos; a biblioteca de empréstimo fica de fora).
- **IMSLP:** a primeira página de cada edição; tocar na imagem abre o PDF completo.
- **CPDL:** não oferece imagens, só os arquivos para baixar.

Para atualizar o índice do Mutopia, rode de novo o script de coleta (`tools/mutopia_crawl.py`, depois `tools/mutopia_build.py` e `tools/mutopia_pages.py`).

## Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | tocar / pausar |
| `←` `→` | voltar / avançar 5 s (`Shift` = 1 s) |
| `↑` `↓` | velocidade |
| `Home` | recomeçar |
| `Esc` | voltar à biblioteca |

## Estrutura

```
index.html          interface
css/style.css       visual
js/midi-parser.js   leitor de arquivos MIDI
js/synth.js         sintetizador de piano (Web Audio)
js/songs.js         músicas incluídas (domínio público)
js/player.js        motor: notas caindo, teclado, pontuação, partículas
js/sheets.js        busca de partituras (Mutopia, IMSLP, CPDL, Internet Archive)
js/app.js           biblioteca, MIDI, entradas e telas
data/mutopia.json   índice do Mutopia Project
assets/mutopia/     MIDIs de piano do Mutopia + CREDITS.md
tools/              scripts que geram o índice do Mutopia
```

Sem dependências e sem etapa de build.
