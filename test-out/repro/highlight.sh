#!/bin/sh
# highlight con fields "*": XERJ non restituisce highlight; con il nome del campo sì.
ES=${ES:-http://localhost:9200}
echo '--- fields "*"'
curl -s $ES/ax-weblogs/_search -H 'content-type: application/json' -d '{"size":1,"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"*":{}}}}'; echo
echo '--- fields "message"'
curl -s $ES/ax-weblogs/_search -H 'content-type: application/json' -d '{"size":1,"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"message":{}}}}'; echo
