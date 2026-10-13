import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

test("HTML do modelo sai como texto, e o negrito ainda aberto no streaming já sai formatado", () => {
  const html = renderToStaticMarkup(<Markdown texto={'Olá <img src="x" onerror="alert(1)"> e [link](javascript:alert(1)) e **headline em curso'} digitando />);

  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain("&lt;img");
  expect(html).toMatch(/<strong[^>]*>headline em curso<\/strong>/);
});
