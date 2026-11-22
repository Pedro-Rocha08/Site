# Aurora Keys 🎹

Aprenda piano com **notas caindo** até as teclas, direto no navegador: conecte seu teclado MIDI, escolha uma música (ou importe seus próprios arquivos `.mid`) e toque junto.

## Como abrir

Abra o `index.html` no **Google Chrome** ou no **Microsoft Edge** (eles suportam Web MIDI). Também funciona publicado no GitHub Pages (Settings → Pages → branch).

Para rodar localmente com um servidor:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Recursos

- **Teclado MIDI** via Web MIDI: detecção automática, escolha de entrada, pedal de sustentação e saída MIDI opcional (para a música tocar no som do seu piano digital).
- **Três modos**: *Ouvir* (assistir), *Praticar* (a música espera você acertar cada nota) e *Tocar* (tempo real, com pontuação, combos e estrelas).
- **Mão esquerda, direita ou ambas**, com as faixas de cada arquivo atribuídas automaticamente (e ajustáveis).
- **Importe suas músicas**: botão "Importar MIDI" ou arraste arquivos `.mid`/`.midi` para a página. Elas ficam salvas no navegador (IndexedDB).
- Controle de velocidade, repetição de trecho A–B, linha do tempo com densidade de notas, recordes por música.
- Nomes das notas em **Dó Ré Mi** ou **C D E**, teclado ajustado à música ou com 88 teclas.
- Sem teclado MIDI? Use o teclado do computador (`Z`…`M` e `Q`…`U`, `[` `]` mudam a oitava) ou toque na tela.
- Modo **Tocar livre** com notas subindo enquanto você toca.

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
js/app.js           biblioteca, MIDI, entradas e telas
```

Sem dependências e sem etapa de build.
