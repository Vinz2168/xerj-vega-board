#!/bin/sh
# Self-contained repro for the XERJ PR (creates and deletes index "repro").
ES=${ES:-http://localhost:9200}; J='content-type: application/json'
curl -s -X DELETE $ES/repro >/dev/null
curl -s -X PUT $ES/repro -H "$J" -d '{"mappings":{"properties":{"host":{"type":"keyword"},"ms":{"type":"float"},"bytes":{"type":"long"},"message":{"type":"text"}}}}' >/dev/null
curl -s -X POST "$ES/_bulk?refresh=true" -H 'content-type: application/x-ndjson' --data-binary '{"index":{"_index":"repro","_id":"1"}}
{"host":"a","ms":10,"bytes":1,"message":"upstream timeout contacting backend"}
{"index":{"_index":"repro","_id":"2"}}
{"host":"c","ms":60,"bytes":2,"message":"ok"}
{"index":{"_index":"repro","_id":"3"}}
{"host":"b","ms":900,"bytes":3,"message":"slow request"}
{"index":{"_index":"repro","_id":"4"}}
{"host":"c","ms":50,"bytes":4,"message":"ok"}
' >/dev/null
echo '## 1a highlight fields "*"';       curl -s $ES/repro/_search -H "$J" -d '{"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"*":{}}}}'; echo
echo '## 1b highlight fields "mess*"';   curl -s $ES/repro/_search -H "$J" -d '{"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"mess*":{}}}}'; echo
echo '## 1c highlight fields "message"'; curl -s $ES/repro/_search -H "$J" -d '{"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"message":{}}}}'; echo
echo '## 2 terms order by percentile';   curl -s $ES/repro/_search -H "$J" -d '{"size":0,"aggs":{"k":{"terms":{"field":"host","order":{"p.95":"desc"}},"aggs":{"p":{"percentiles":{"field":"ms","percents":[95]}}}}}}'; echo
echo '## 3 terms order invalid path';    curl -s -w ' [HTTP %{http_code}]' $ES/repro/_search -H "$J" -d '{"size":0,"aggs":{"k":{"terms":{"field":"host","order":{"nope":"desc"}}}}}'; echo
echo '## 4 lenient false';               curl -s -w ' [HTTP %{http_code}]' $ES/repro/_count -H "$J" -d '{"query":{"query_string":{"query":"bytes:abc","lenient":false}}}'; echo
echo '## 5 warning header';              curl -si $ES/ | grep -i '^warning'
curl -s -X DELETE $ES/repro >/dev/null
