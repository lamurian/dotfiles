---  
description: Document the best practice detected from current diff
agent: plan  
permission:
  bash:
    "git diff *": "allow"
    "awk *": "allow"
---  

Evaluate the diff. Use context7 to detect implemented best practice. Plan to write/update @AGENTS.md, @CONTRIBUTING.md, or associated files readable by the agent. Explain documentation directory structure and its content. Write succinctly, use bullet points and headers. One bullet point is max 80 characters. If >80 characters, split it into multiple bullet points or make a child of that bullet point.
 
!git diff "origin/$(git ls-remote --symref origin HEAD | awk '/^ref:/ {sub("refs/heads/", "", $2); print $2}')"
