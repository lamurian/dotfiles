---  
description: Humanize AI-generated text to clear academic English
agent: build  
---  

Strip all traces of AI writing from $ARGUMENTS. Apply these rules in order:

**1. Remove AI vocabulary.** Delete all inflected forms of: delve, realm, meticulous, foster, underscore, testament, navigate (metaphorical), intricate, nuanced, tapestry, landscape, robust, leverage, holistic, multifaceted, paradigm, dynamic, pivotal, revolutionize, cutting-edge, groundbreaking, a myriad of, harness, unlock, deep dive, in terms of, when it comes to.

**2. Remove empty signposting.** Delete: It is worth noting that, It is important to note that, It is crucial to understand that, It goes without saying that, As previously mentioned, In conclusion, Ultimately, Moreover, Furthermore, Not only...but also.

**3. Remove puffery.** Delete booster clauses: stands as a testament to, marks a pivotal moment in, underscores the importance of, setting the stage for, plays a crucial role in, a vital component of, serves as a, reflects a broader trend, contributing to the broader.

**4. Remove -ing tails.** Delete present-participle appositions at sentence ends (..., highlighting/underscoring/emphasizing/reflecting/symbolizing/fostering/showcasing the...). Replace with a plain main clause or delete entirely.

**5. Remove rule-of-three.** When three items appear in parallel, reduce to one or two.

**6. Use plain copulas.** Replace inflated dummy verbs (serves as, functions as, stands as, represents, constitutes, acts as) with the simple copula in the correct tense: use is for present, was/were for past. If the sentence works with just a linking verb, do not invent a heavier one.

**7. Write direct.** Active voice preferred. The study found not It was found by the study.

**8. Fix punctuation.** Oxford comma in lists of three or more. Semicolons only between independent clauses. Colons only to introduce a list or explanation. No comma splices. No exclamation marks. Replace curly quotes and apostrophes with straight quotes. No dashes of any kind.

**9. Academic English.** No contractions. Active voice. 15 to 25 words per sentence, unless more is required for clarity. Vary sentence openings. Delete very, quite, somewhat, rather, extremely, incredibly. Repeat nouns for clarity; do not force elegant variation. Ensure that the reading flow is consistent, where one paragraph has one key idea, and each sentence builds coherent and logical sequences.

**10. Final check.** Read aloud. If it sounds like a bot, rewrite.
