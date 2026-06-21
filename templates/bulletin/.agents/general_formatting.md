# General Formatting

- For double quotes, use Unicode left/right double quotation marks (```\char"201C``` /
```\char"201D```) instead of ASCII straight quotes (```"```), double back-ticks
(``` `` ```), or double single quotes (``` '' ```). If the source text uses those
conventions, convert them.
- For single quotes nested inside double quotes, use Unicode left/right single
quotation marks (```\char"2018``` / ```\char"2019```) instead of backtick/straight
apostrophe (``` ` ``` / ```'```).
- For long dashes, use Unicode em dash (```—```, U+2014) or en dash (```–```,
  U+2013) instead of LaTeX ```---``` or ```--```. If the source uses em/en dashes,
  preserve them as the Unicode character.