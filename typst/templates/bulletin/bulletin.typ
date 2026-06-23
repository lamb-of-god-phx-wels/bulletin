#import "metadata.typ": meta
#import "private-data.typ": private
#import "../../styles/bulletin.typ": *
#import "sections/01-welcome.typ": welcome-page
#import "sections/02-gathering.typ": gathering
#import "sections/03-word.typ": word
#import "sections/04-prayers.typ": prayers
#import "sections/05-announcements.typ": announcements
#import "sections/06-back-page.typ": back-page

#show: bulletin-style

#cover-page(meta)
#welcome-page(meta, private)
#gathering(meta)
#word()
#prayers()
#announcements(meta)
#back-page()
