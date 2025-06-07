gco msg-thunk; echo msg-thunk; \
time { ./wildcards-plus-tool.js ./sample-prompts/artsy-sf-character.txt > /dev/null; }; \
cp ./wildcards-plus-tool.js msg-thunk.js; \
gco alt2-audit-unsafe; echo alt2-audit-unsafe; \
time { ./wildcards-plus-tool.js ./sample-prompts/artsy-sf-character.txt > /dev/null; }; \
cp ./wildcards-plus-tool.js alt2-audit-unsafe.js;
