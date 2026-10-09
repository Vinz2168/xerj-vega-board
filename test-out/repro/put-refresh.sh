#!/bin/sh
# PUT _doc?refresh=true seguito subito da _search sullo stesso indice (indice di prova, cancellato alla fine).
ES=${ES:-http://localhost:9200}
curl -s -X DELETE $ES/xvb-compat-test >/dev/null
echo '--- PUT ?refresh=true'; curl -s -X PUT "$ES/xvb-compat-test/_doc/a-b?refresh=true" -H 'content-type: application/json' -d '{"title":"T","updated_at":1,"definition":"{}"}'; echo
echo '--- _search subito dopo'; curl -s -X POST $ES/xvb-compat-test/_search -H 'content-type: application/json' -d '{"size":200,"_source":["definition"]}'; echo
echo '--- PUT senza refresh, stesso id (sovrascrive)'; curl -s -X PUT "$ES/xvb-compat-test/_doc/a-b" -H 'content-type: application/json' -d '{"title":"T2","updated_at":2,"definition":"{}"}'; echo
echo '--- _search subito dopo'; curl -s -X POST $ES/xvb-compat-test/_search -H 'content-type: application/json' -d '{"size":200,"_source":["title"]}'; echo
echo '--- mapping creato dinamicamente'; curl -s $ES/xvb-compat-test/_mapping; echo
curl -s -X DELETE $ES/xvb-compat-test >/dev/null
