A feature-rich 'wildcards' script (and command-line tool) for Draw Things, providing numerous features to allow flexible prompt generation.

**Features:**
- Weighted alternatives in wildcards
- Nested wildcards
- 'Smart' text joining logic
- Comments
- Named wildcards - the basics
- Named wildcards - 'latching' (and unlatching) a named wildcard's value
- Named wildcards - getting multiple items at once
- Fun named wildcard tricks - recursion
- Escaped characters
- Setting 'boolean' flags and using guards
- Putting it all together and some final thoughts
- A quick note on 'types' and names
- Some useful built in named wildwards

**Weighted alternatives in wildcards**
 
A positve integer that occurs before any of the content in one of a wildcard's alternatives will be interpreted as a weight influencing how likely that alternative is to be picked. If an alternative does not contain an integer before any of its content, it recieves the default weight of 1. I'll try to give a more rigorous definition of 'content' a bit futher in but, basically, anything inside an alternative that isn't a weighting or a guard is 'content'... don't worry about what 'guard's are yet, I'll explain that feature a couple of pages... so far, weightings are the only element I've shown you that *isn't* 'content'.

Example prompt:
```
A { dog | 2 cat } in a { field | 3 kitchen }.
```

This example will generate prompts containing 'cat' instead of 'dog' two times in three, and most of the time (three times in four) the animal will be in a kitchen.

**Nested wildcards:**

The content of an alternative in a wildcard may include another wildcard, which is expanded recursively along with the enclosing wildcard.

Example prompt:
 `{ { brown | 3 spotted } dog | 2 { siamese | 2 tabby } cat } in a { field | 3 kitchen }`
 
 This example is similar to the previous one, but it will generate `spotted dog`s more often than `brown dog`s, and it will prefer generating `tabby cat`s over generating `siamese cat`s
 
 **'Smart' text joining logic:**
 
 `wildcards-plus` uses a few simple strategies to join the fragments of generated text together in a way that I think produces nicer/more useful output: ordinarily, a single space is added between the fragments being joined together **unless** one of the following applies, in which case the fragments are joined without a space in between them.:
 
 - the right hand piece begins with a punctuation character (any of `'_-,.?!;:`).
 - the piece on either side terminates with a `_` or `-` character.
 - the fragment on the right begins with a `<` character (which will be omitted from the output).
 - the fragment on the left ends with a `(` or  `[` character.
 - the fragment on the right begins with a `)` or `]` character.
 
 Example prompt:
`fire {<man | <fighter | <truck | brigade | _elemental | { , water, earth and air | and ice } }. \n`

All possible outputs:
```
fireman.
firefighter. 
firetruck. 
fire brigade. 
fire_elemental. 
fire, water, earth and air. 
fire and ice. 
```

In addition, it will try to make appropriate use of 'a' and 'and' based on whether the right hand fragment begins with a vowel or a consonant.

Example prompt:
`Would you like a { apple | orange | <nother one } ?`

All possible outputs:
```
Would you like a drink? 
Would you like an apple? 
Would you like another one? 
```

**Comments:**

Prompts may include comments, which work in essentially the same way as they work in C. Both line comments (`//`) and block comments (`/* ... */`) are supported... this feature isn't very exciting, I'm just explaining it early because I'll be using comments in future examples of prompts to help explain how they work.

**Named wildcards - the basics:**
 
Named wildcards may be defined may be defined by employing the `:=` device. Defining a named wildcard produces no output immediately, but references the named wildcard found further on in the promp will pick a result from that named wildcard. The characters permitted in the names of named wildcards are almost the same as those permitted in identifiers in C, but also permitting dashes after the first character (so, the characters A-Z, a-Z, 0-9, `_` and `-`, but may not begin with a number). Examples of valid names for named wildcards include `foo`, `fo0`, `_foo` and `foo_bar`. Ordinarily, references to named wildcards a prefixed with a `@` (later on in 'Named wildcards - getting multiple items at once', we'll cover more complex prefixes, but you don't have to worry about those yet).

Named prompt definitions must be at the 'top level' of the prompt: they can't themselves be nested within a wildcard's curly braces.
 
Example prompt:
```
// define a named wildcard named '@weapon':
@weapon := {2 spear|2 sword|axe|halberd|scimitar|kukri|rapier|sabre|cutlass|mace|dagger}

// use that named wildcard in our prompt here to get a randoom weapon:
A {man|woman} {holding|swinging|2 wielding|3 brandishing} a @weapon.
```

Some sample outputs:
```
A man wielding a rapier. 
A woman holding a dagger. 
A woman swinging a kukri. 
A man brandishing a sabre. 
```

**Named wildcards - 'latching' (and unlatching) a named wildcard's value:**

A named wildcard may be 'latched' using by using an expression preceding the wildcard's name with a `@#` sequence. Latching a wildcard does not produce any immediate output: instead, it causes that wildcard to silently pick an alternative and 'latch' it into memory. From then onwards, a reference to that named wildcard will return that same result... unless you unlatch it again, using a `@!` sequence. 

A silly example:
```
@bird := {duck|goose}

// set the latch on the @bird named wildcard:
@#bird 

// since @bird is latched, both of these will expand to the same latched value:
@bird, @bird, 

// unlatch the @bird named wildcard:
@!bird 

// since @bird is not latched, this expansion randomly pick a fresh value: 
@bird
```

Occasionally this will get you `duck, duck, goose`, but you'll just as freqyently end up with `goose, goose, duck` or `duck, duck, duck`.

If you want to, you can unlatch and immediately re-latch a wildcard's value using a `@!#` sequence.

**Named wildcards - getting multiple items at once:**

You've got something like this...

`@weapon := {2 spear|2 sword|axe|halberd|scimitar|kukri|rapier|sabre|cutlass|mace|dagger}`

... and you want more than one result? You can expand more results at once from a named wildcard by supplying a positive integer after the `@` character, or supplying an  using two such integers separated by a `-`. Ordinarily they're separated by a space, but if you add a `,` after the number you can get a comma separated list, or get a nice plain-english list with the word 'and' in the appropriate spot by using an `&` instead. 

Bonus: placing a `^` immediately after the `@` will capitalize the first result - this works even if you're just getting one item... the AI probably doesn't care, but I think this makes prompts more readable to human readers, so I
  
Some examples:
```
@4weapon.     // get exactly 4 picks from @weapons separated by spaces, like 'sword sabre mace axe.'.
@4,weapon.    // get exactly 4 picks from @weapons separated by comma+space sequences, like 'sword, sabre, mace, axe.'.
@1-4&weapons. // get between 1 and 4 picks from @weapons, rendered in plain-english style, like 'sword, sabre and mace.'.
@^1-4&weapons. // get between 1 and 4 picks from @weapons, rendered in plain-english style and with the first word capitalized, like 'Sword, sabre and mace.'.
```

**Fun named wildcard tricks - recursion:**

If you're clever, then maybe you already guessed that this one was coming. This one isn't *really* it's own feature at all: it's just a natural consequence of the combination of the named wildcard and the nested wildcards feature. 

The alternatives in a wildcard can contain references to named wilcards... an alternative in a named wild card may even refer back to *that very same* named wildcard. If you're creative, you can use this for plenty of cool tricks. Be warned, though, you 've got to pay a bit of attention to where you're creating circles: if you're too clever for your own good you could construct a wildcard that recurses infinitely and never stops expanding. Just be careful, and you should be able to avoid this pitfall. 

So, what can we do with this? Well, how about an example. Want an imposing arsenal of exotic weapons for your dark fantasy scene? Let's combine a few of the features I've already talked about: weighted alternatives, nested wildcards and recursion. Try this prompt out.

Example prompt:
```
// Weapons:
@weapon       := {spear|sword|axe|halberd|scimitar|kukri|rapier|sabre|cutlass|mace|scythe|trident|blade|kriss|stiletto|dagger|trident|harpoon}
@weapons      := { A {2 {|2 @adjs} @weapon | 5 {2|3 @adjs} @weapon @weapons_tail } }
@weapons_tail := {2 and a {2|3 @adjs} @weapon|3 ... a {2|3 @adjs} @weapon @weapons_tail}

// Adjectives:
@adjs         := {2 @adj |4 @adj @adjs_tail }
@adjs_tail    := {and @adj| , @adj @adjs_tail }
@adj          := {fierce|fearsome|cruel-edged|serrated|mighty|eldritch|otherwordly|menacing|calamitous|beastly|fiery|malevolent|adamantine|spined
                 |antediluvian|verdigris-encrusted|pearl-inlaid|ominous|razor-edged|serpentine|viridian|sinuous|opalescent|venomous|imposing}
 
// Expand @weapon five imes, on a fresh line each time:
@weapons. \n
@weapons. \n
@weapons. \n
@weapons. \n
@weapons. \n
```

Sample output:
```
A mace... an antediluvian scimitar... a sword... a sinuous and serpentine rapier and a spear. 
A beastly, fearsome and razor-edged kukri. 
A pearl-inlaid, razor-edged, spined and serrated halberd... an eldritch mace... a venomous sword and a cutlass. 
An axe... an antediluvian, verdigris-encrusted and beastly sword... an antediluvian blade and a cruel-edged and serpentine sword. 
A kukri and an opalescent, spined, fiery, verdigris-encrusted and spined spear. 
```

I'm sure I haven't discovered all the things recursive wildcards can do yet... give 'em a try, maybe you'll discover some cool results and techniques yourself that I haven't thought of yet!

**Escaped characters:**

If you were paying close attention, you might have spotted that `\n` in the previous prompt and noticed the carriage return it produced in the output. That's right, `wildcards-plus` has escaped characters! They work much the same as you might be used to if you've done much programming: a `\` removes whatever special significance a character may have had to `wildcards-plus`. If you escape a character didn't have any special significance, the escape character will be harmlessly removed. In a few cases (like the `\n` you've already scene), the `\` will do the opposite and add a special significance to a character that didn't have one, such as turning `\n` into an actual newline in the output.

Wanna print the name ot the `@weapon` wildcard, without actually picking an item from it? You can, just use an escape character!

Example prompt:
```
@weapon := {spear|sword|axe|halberd|scimitar|kukri|rapier|sabre|cutlass|mace|scythe|trident|blade|kriss|stiletto|dagger}

An \i\t\e\m from the \@weapon wildcard: @weapon // only one item will actually be picked from @weapon!
```

Sample output:
```
An item from the @weapon wildcard: dagger
```

As you can see, the bacslashes in `\i\t\e\m` were simply removed while the backslash in front of the `@` in `\@weapon` turned it into ordinary plain text (instead of a reference to the named wildcard).

**Setting 'boolean' flags and using guards:**

You can set a flag including an item consisting of a `#` followed by an identifier in the content of a prompt or an alternative, like this `#the_flag_name`. Similarly to named wilcards, the names of flags follow the same rules as C identifiers.

Flags don't actually 'store' any value value per se: the only feature of a flag that ever matters is whether it is set or not. Any flag name that you have *not* explicitly set using a `#flag_name`-style item in the content of one of a wildcard's alternatives (and that alternative being picked) is simply not set. Once set, a flag is set permanently and cannot be unset: permitting that didn't seem very useful to me and it seemed like it could lead to confusing situations.

You're probably wondering what these flags are good for... they're good for only one thing (or maybe two, depending on how you'd prefer to count): they can be used in guards. There are two types of guards: 'check' guards, which look like `?this_flag_must_be_set` and 'not' guards, which look like `!this_flag_must_not_be_set`... these might not be the best names for the two types, but they were the best I could think of right now.

Guards must occur in one of a wildcard's alternatives before any of the alternative's 'content', near where an alternatives' weight goul. Placing a guard at the top level outside of any wildcard wouldn't make a lot of sense, and so is not supported.

When selecting an alternative from a wildcard, the guards are first checked. 

'check' guards (`?tho_flag`) ensure that a flag *is* set: if an alternative has a 'check' guard (`?the_flag`) and that flag is not set, that alternative is unavailable and cannot be picked. 

'not' guards (`!tho_flag`), on the other hand, ensure that the flag is *not* set: if an alternative has a 'not' guard (`!the_flag`) and that flag *is* set, that alternative is unavailable and cannot tbe picked.

You could set up guards such that none of a wildcard's alternatives are available, in which case that wildcard will produce no output.

Example prompt:
```
a {?invisible invisible} man.
```

Since this prompt never sets the `invisible` flag, the wildcard's only alternative is unavailable, and as a result the only output this prompt can generate is `A man.`. Let's fix that.

Example prompt:
```
#invisible A {?invisible invisible} man.
```

This time, since the `invisible` flag is set, the wildcard's alternative *is* available. There's no second alternative, so now the only output this prompt can generate is `An invisible man`... still not very exciting since it can only generate one string.

Example prompt:
```
#invisible A {|?invisible invisible} man.
```

Now we've added an un-guarded empty alternative to the wildcard. So, half the time it will generate `A man.` and half the time it will generate `An invisible man.`. We could have accomplished the same thing by putting the flag setting directive itself in a wildcard alternative that was only selected half the time, like this:

Example prompt:
```
{|#invisible} A {?invisible invisible} man.
```

Now, the second wildcard always picks its single alternative if `invisible` is set, but because the first wildcard in the prompt only chooses the alternative that sets the `invisible` flag half the time, the overall result is essentially same as the prior example. Let's make things a little more interesting:

```
 // first, let's randomly set either the #warrior or #wizard flag and output some text:
 A { #warrior { warrior | knight   |  barbarian } 
   | #wizard  { wizard  | sorcerer |  conjurer  } }
   
// now, we can use guards on the flag's we set to ensure our here has an appropriate weapon:
holding a { ?warrior { sword | axe  | spear       }
          | ?wizard  { staff | wand | crystal ball } }
          
// unless they're a wizard, they might have a shield:
{ | !wizard and a shield }
.
```

The first wildcard in the prompt has two alternatives, each of which sets a flag and then expands the nested wildcard. So, once the first wildcard has been expanded, either `warrior` or `wizard` is set. 

In the prompt's second wildcard, each alternative is guarded with a 'check' guard... so, depending on which flag was set, only one of it's alternatives is available.

The prompt's third wildcard used a 'not' guard. Now, if you've ever played D&D, you'll know that wizards can't use shields... so, we're not going to add the text `and a shield` if  `wizard` is set. It contains an empty alternative though, and since no weight was specified both alternatives have the default weight of 1... so, even when `wizard` is not set it will only add that text half of the time.

All told, it will generate phrases like these:
```
A conjurer holding a crystal ball.
A wizard holding a staff.
A barbarian holding an axe.
A knight holding an axe and a shield.
A warrior holding a sword and a shield.
A knight holding a spear.
```

One pattern I've found myself using frequently are alternatives like this: `!some_flag #some_flag some content`, which basically means "don't pick this alternative if `some_flag` is already set but, if this alternative is picked, set `some_flag` and yield the text `some content`. For example, consider this wildcard:

```
@ingredients := { !used_meat #used_meat chicken | !used_meat #used_meat beef | vegetables | bread | rice }
```

If you get multiple items from this wildcard, you'll only get one meat item since the alternatives containing meat items both set the `used_meat` flag, preventing the selection of a second meat item.

To make this pattern more convenient, a `!#` sequence can be used: `!#used_meat` means the same thing as `!used_meat #used_meat`, allowing the previous example to be simplified into:

```
@ingredients := { !#used_meat chicken | !#used_meat beef | vegetables | bread | rice }
```

*Tip*: If you're clever, you could intentionally  create situations where guards leave only a single alternative available, depending on the particular flags that are set. This can let be used  steer named wildcards into producing particular results when certain flags are set. In the next section, you'll see an example where I use (or maybe abuse) this technique to give a character the correct pronouns for their gender.

**Putting it all together and some final thoughts:**

Let's have a little fun and make a fancier prompt that makes use of most (not quite all) o the features that w've covered thus far. This prompt will be a little longer, but don't worry, it's not using any features that I haven't already explained, it should all make sense if you take the time to read through it. Here we go:

```
@quality      := { rusty | masterwork | fine | bejeweled | glowing | magical |}
@weapon       := {2 spear|2 {two-handed|bastard|short} sword|3 axe|halberd|scimitar|kukri|rapier|sabre|cutlass|mace|dagger|blade}
@friend       := {father|mother|mentor|teacher|lover}

@#weapon                // Set a latch on the @weapon wildcard, since we're going to make several references to the same weapon.
@#friend                // Set a latch on the @friend wildcard, since we're going two references to the same friend.
{#female|#male|#neuter} // Randomly pick one of these three alternatives and set a gender flag.

// The gender flag and the guards here will ensure that only one alternative is available, we'll use that to pick appropriately gendered pronouns:
@pronoun_3rd_object  := {?female her |?male him | ?neuter it  }
@pronoun_3rd_subject := {?female she |?male he  | ?neuter it  }
@pronoun_pos_adj     := {?female her |?male his | ?neuter its }
@pronoun_pos         := {?female hers|?male his | ?neuter its }

@^pronoun_3rd_subject { swung | brandished | presented } @pronoun_pos_adj @quality @weapon, that very same @weapon @pronoun_pos_adj
{beloved|dear|long lost|} @friend had
{{trained|taught} @pronoun_3rd_object to use|forged {for|with} @pronoun_3rd_object|given to @pronoun_3rd_object|bestowed upon @pronoun_3rd_object
|entrusted @pronoun_3rd_object with|bequeathed unto @pronoun_3rd_object} so many years ago...
if only @pronoun_pos_adj @friend were still {with|beside|watching} @pronoun_3rd_object today, to see how {skillfully|confidently|expertly}
@pronoun_3rd_subject {gripped|held|wielded|handled} the @weapon now!

The {menacing|brutish|foul} {demon|orc|warrior} {facing|looming over} @pronoun_3rd_object {snarled|growled|hissed|let out a battle cry|howled} and
{lunged|advanced|leapt towards @pronoun_3rd_object}, raising its

@!weapon /* Unlatch the @weapon wildcard, so that the next time we reference it will 're-roll' a new weapon for the next part of our sentance. */

@weapon to meet @pronoun_pos_adj {|own|tightly-held} weapon with a clang, and their {battle|struggle|duel|deadly dance} began.
```

You'll see that every almost every feature covered thus far is used in the prompt: named wildcards (including latching), nested wildcards, `<` to control text joining, flags and guards. What sort of output does the prompt generate? Here are just a few examples:

```
She brandished her glowing scimitar, that very same scimitar her beloved mentor had entrusted her with so many years ago... if only her mentor were still with her today to see how confidently she wielded the scimitar now! The foul demon looming over her hissed and leapt towards her, raising its axe to meet her tightly-held weapon with a clang, and their deadly dance began.

It swung its rusty scimitar, that very same scimitar its lover had taught it to use so many years ago... if only its lover were still beside it today, to see how skillfully it held the scimitar now! The brutish orc looming over it let out a battle cry and leapt towards it, raising its two-handed sword to meet its weapon with a clang, and their battle began.

He swung his bejeweled halberd, that very same halberd his beloved mentor had bequeathed unto him so many years ago... if only his mentor were still with him today, to see how skillfully he handled the halberd now! The brutish orc facing him let out a battle cry and lunged, raising its sabre to meet his tightly-held weapon with a clang, and their duel began.

He brandished his masterwork sabre, that very same sabre his long lost mother had trained him to use so many years ago... if only his mother were still beside him today, to see how expertly he handled the sabre now! The foul warrior facing him snarled and lunged, raising its mace to meet his weapon with a clang, and their struggle began.

She swung her glowing two-handed sword, that very same two-handed sword her beloved father had forged with her so many years ago... if only her father were still watching her today, to see how skillfully she handled the two-handed sword now! The brutish orc looming over her howled and leapt towards her, raising its spear to meet her weapon with a clang, and their deadly dance began.

```

Wow! Dramatic stuff, huh? Probably not the best prompt for the purpose of generting images, but it should give you an idea of how much these features can let you do.

Hopefully this readme has given you an idea of the sorts of things `wildcards-plus` can do, and maybe you've thought of a few ideas for interesting things to do with it... you'll probably even think of some ideas I haven't thought of myself yet! If you do, feel free to reply to the post in #scripts showing off what you've come up with. Maybe you've got ideas for other useful features that I could add toe the script? Let me know, I'd love to hear your thoughts and ideas!

**A quick on 'types' and names:**j

There are two 'types' of entity in this little language that have names: named wildcards and flags. These two types of entity each exist in their own 'namespace'. In other words, you could simultaneously have both a named wildward that is named `weapons` **and** have a flag named `weapons` and that's totally fine, there won't be any problem with the fact that they happen to have the same name. Both are global, there isn't any concept of 'scope', lexical or otherwise.

**Some useful built in named wildwards:**

For user convenient, `wildcards-plus` now includes some helpful built in named wildcards.

**Named wildcards to generate consistent pronouns**:
```
@set_gender_if_unset := {!female !male !neuter {3 #female|2 #male|#neuter}}
@gender              := {@set_gender_if_unset {?female woman |?male man |?neuter androgyne }}
@pro_3rd_subj        := {@set_gender_if_unset {?female she |?male he  |?neuter it }}
@pro_3rd_obj         := {@set_gender_if_unset {?female her |?male him |?neuter it }}
@pro_pos_adj         := {@set_gender_if_unset {?female her |?male his |?neuter its}}
@pro_pos             := {@set_gender_if_unset {?female hers|?male his |?neuter its}}
```

You may use these wildcards to generate pronouns for a character. Since they all expand `@set_gender_if_unset` first, the generated pronouns will be consistent. It will select female a bit more frequently than male, due to my own preferences (I'm usually more interested in drawing women than men), but if your preferences differ you can either set a gender flag yourself or redefine `@set_gender_if_unset` to align with your own preferences.

**Named wildcards that generate Pony score strings**:
```
@pony_score_9        := {score_9}
@pony_score_8_up     := {score_9, score_8_up}
@pony_score_7_up     := {score_9, score_8_up, score_7_up}
@pony_score_6_up     := {score_9, score_8_up, score_7_up, score_6_up}
@pony_score_5_up     := {score_9, score_8_up, score_7_up, score_6_up, score_5_up}
@pony_score_4_up     := {score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up}
```

For the convenience of Pony users, these wildcards will generate commonly used Pony 'score' strings.

**Named wildcards that generate SD style weighting suffixes**:
The `@random_weight` and `@high_random_weight` wildcards will generate weighting strings like `:1.4`, with `@high_random_weight` ensuring the weighting is at least `:1.5`.

They can be used like `(some_tag @high_random_weight)`.

**Integrated content from @Wizard Whitebeard's 'Wizard's Scroll of Artist Summoning'**:
The named wildcard `@wizards_artists` contains the artists from @Wizard Whitebeard's lovely 'Wizard's Scroll of Artist Summoning' script, and `@wizards_artists_styles` will retrieve the style list for the matching artist.

Here's an example prompt making use of all of these built-in named wildcards:
```
@pony_score_7_up \n
A masterpieze by @wizards_artists.
A @gender in a room, @pro_3rd_subj is sitting on @pro_pos_adj ({chair|throne|couch} @high_random_weight). \n
By @wizards_artists, @wizards_artist_styles.
```

Sample output:
```
score_9, score_8_up, score_7_up, 
A masterpieze by Gerald Brom. A man in a room, he is sitting on his (couch: 1.7). 
By Gerald Brom, dark, eerie, fantasy, gothic, horror, pulp.
```
