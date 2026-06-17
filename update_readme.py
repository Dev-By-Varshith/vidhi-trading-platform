import re

with open('README.md', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove ASCII art and quote
pattern_ascii = r'```\n.*?╚═══╝╚═╝  ╚═╝\n```\n\n> \*\*A zero-IPC, sub-microsecond algorithmic trading arena\.\*\*\n> Built on bare-metal C\+\+20, kernel-isolated sandboxes, and hardware-sympathetic memory physics\.'
content = re.sub(pattern_ascii, '', content, flags=re.DOTALL)

# 2. Add Getting Started section before "## I. THE PARADIGM SHIFT"
getting_started = """---

## GETTING STARTED

To clone and work with this repository locally:

```bash
# Clone the repository
git clone https://github.com/Dev-By-Varshith/vidhi-trading-platform.git

# Navigate into the project directory
cd vidhi-trading-platform
```

Please refer to the deployment section below for full bare-metal or Docker compose deployment steps.

---"""
content = content.replace('---', getting_started, 1)

# 3. Remove Emojis from INNOVATION headings
emojis = ['⚡ ', '🧠 ', '🔒 ', '📡 ', '🐍 ', '⏱️ ', '🤖 ', '✅ ']
for emoji in emojis:
    content = content.replace(f'<summary><strong>{emoji}INNOVATION', '<summary><strong>INNOVATION')

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(content.lstrip())
