# Mapa de calor

Página estática para recorrer Colombia, un departamento, un municipio y, en Cali, las comunas y los puestos de votación.

Los números son totales. El archivo `data/heatmap.json` no trae cédulas, nombres ni el corte por líder.

El mapa base es [OpenFreeMap](https://openfreemap.org/) (datos de OpenStreetMap). Los límites de comunas y corregimientos de Cali son del IDESC, Alcaldía de Cali, licencia CC BY-SA 4.0. Los puntos de los puestos son aproximados.

Para regenerar el JSON hace falta la base local del proyecto privado y el script `scripts/exportar_mapa_lite.py`. Esta carpeta, ya generada, se puede publicar sola.
