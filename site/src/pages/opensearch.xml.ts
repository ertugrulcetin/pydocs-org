// Lets browsers add PyDocs as a search engine (ClojureDocs has the same).
import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/site';

export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>PyDocs</ShortName>
  <Description>Search Python standard library docs and examples</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16" type="image/x-icon">${SITE_URL}/favicon.ico</Image>
  <Url type="text/html" method="get" template="${SITE_URL}/search?q={searchTerms}"/>
</OpenSearchDescription>
`,
    { headers: { 'Content-Type': 'application/opensearchdescription+xml' } },
  );
