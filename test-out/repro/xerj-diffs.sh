#!/bin/sh
# Difformità di XERJ rispetto a Elasticsearch 8.x, casi minimi. Uso: ES=http://localhost:9200 sh test-out/repro/xerj-diffs.sh
ES=${ES:-http://localhost:9200}
J='content-type: application/json'
echo '### D1 highlight: fields "*" (atteso: highlight su message)'
curl -s $ES/ax-weblogs/_search -H "$J" -d '{"size":1,"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"*":{}}}}'; echo
echo '### D1b highlight: fields "mess*" (atteso: highlight su message)'
curl -s $ES/ax-weblogs/_search -H "$J" -d '{"size":1,"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"mess*":{}}}}'; echo
echo '### D1c controllo: fields "message" (funziona)'
curl -s $ES/ax-weblogs/_search -H "$J" -d '{"size":1,"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"message":{}}}}'; echo
echo '### D2 terms order su percentiles "m.95" desc (atteso: api-2, api-1, ...)'
curl -s $ES/ax-weblogs/_search -H "$J" -d '{"size":0,"aggs":{"k":{"terms":{"field":"host","size":5,"order":{"m.95":"desc"}},"aggs":{"m":{"percentiles":{"field":"response_ms","percents":[95]}}}}}}'; echo
echo '### D3 terms order su aggregazione inesistente (atteso: 400 "Invalid aggregator order path")'
curl -s -w ' [HTTP %{http_code}]' $ES/ax-weblogs/_search -H "$J" -d '{"size":0,"aggs":{"k":{"terms":{"field":"host","size":2,"order":{"zz":"desc"}}}}}'; echo
echo '### D4 query_string lenient:false con valore non numerico su long (atteso: 400 query_shard_exception / number_format_exception)'
curl -s -w ' [HTTP %{http_code}]' $ES/ax-weblogs/_count -H "$J" -d '{"query":{"query_string":{"query":"bytes:abc","lenient":false}}}'; echo
echo '### D5 header Warning vuoto su ogni risposta (atteso: nessun header Warning senza deprecazioni)'
curl -si $ES/ | grep -i '^warning'
echo '### D6 _cat/indices include gli indici di sistema .xerj_* (atteso: indici di sistema nascosti di default)'
curl -s "$ES/_cat/indices?format=json&h=index"; echo
