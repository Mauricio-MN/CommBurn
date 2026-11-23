# Plano: prévias raster temporárias na prancheta

- [x] Criar imagens temporárias limitadas em resolução, sem modificar documentos, SVG exportado ou G-code.
- [x] Usar imagem da camada no brilho, reutilizando-a quando a aparência não mudar e descartando resultados obsoletos.
- [x] Usar imagens da seleção durante movimentos grandes, preservando a ordem visual e restaurando os vetores ao soltar.
  - [x] Manter movimento, histórico, coordenadas, bloqueios e marcadores existentes.
  - [x] Evitar que imagens produzidas após o fim do arrasto sejam exibidas.
- [x] Manter uma alternativa vetorial quando a geração da imagem não for possível.
- [x] Cobrir cache, invalidação, arrasto, cancelamento e preservação do modelo por testes; verificar a interface no navegador.
- [x] Automatizar a integração no navegador com uma árvore SVG recursiva de 1.024 objetos, comparações do projeto e limites de tempo.
