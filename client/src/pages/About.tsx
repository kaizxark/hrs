import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Check,
  Database,
  Droplets,
  EyeOff,
  FileCheck2,
  HeartHandshake,
  House,
  LockKeyhole,
  PhoneCall,
  Search,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import { EmergencyDropup } from "./Home";
import SiteFooter from "@/components/SiteFooter";

const processSteps = [
  {
    title: "Register your basic details",
    copy: "The info needed for the blood grouping camp.",
    icon: FileCheck2,
  },
  {
    title: "Get your blood group checked",
    copy: "Done on the spot at the camp, and you get your result right away.",
    icon: Droplets,
  },
  {
    title: "Your record gets completed",
    copy: "HRS adds your checked blood group to your profile.",
    icon: Database,
  },
  {
    title: "You're asked separately about becoming a donor",
    copy: "Whether you're okay being contacted later if your blood group is needed.",
    icon: HeartHandshake,
  },
  {
    title: "You get an HRS ID",
    copy: "Once your details, blood group, and consent are all in, your record is saved.",
    icon: ShieldCheck,
  },
  {
    title: "Eligible donors go into the directory",
    copy: "Only people who've agreed to be contacted show up in the public search.",
    icon: Search,
  },
  {
    title: "HRS steps in when blood is needed",
    copy: "People can search the directory or reach out to HRS directly, and HRS handles the rest privately.",
    icon: LockKeyhole,
  },
];

const doesItems = [
  "Keep blood group records organised",
  "Maintain a list of people willing to be contacted",
  "Help match people by blood group",
  "Keep contact details private",
  "Handle communication through HRS",
];

const doesNotItems = [
  "Show phone numbers or emails publicly",
  "Guarantee a listed person is available",
  "Force anyone to donate",
  "Guarantee blood will be available",
  "Replace the medical checks needed before donating",
];

function LetterReveal({ text }: { text: string }) {
  return (
    <span className="about-letter-reveal" aria-hidden="true">
      {text.split(/(\s+)/).map((word, wordIndex) =>
        word.trim() ? (
          <span className="about-letter-word" key={`${word}-${wordIndex}`}>
            {Array.from(word).map((character, characterIndex) => (
              <span
                className="about-letter"
                key={`${character}-${characterIndex}`}
                style={
                  {
                    "--letter-index": text.slice(
                      0,
                      text.indexOf(word) + characterIndex
                    ).length,
                  } as React.CSSProperties
                }
              >
                {character}
              </span>
            ))}
          </span>
        ) : (
          word
        )
      )}
    </span>
  );
}

export default function About() {
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    if (emergencyOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [emergencyOpen]);

  useEffect(() => {
    const revealItems = document.querySelectorAll<HTMLElement>(
      ".about-page .about-scroll-reveal"
    );
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );

    revealItems.forEach(item => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const closeEmergency = () => setEmergencyOpen(false);

  return (
    <div className="portal-shell about-page">
      <main className="about-main">
        <section className="about-hero motion-section">
          <div className="about-hero-copy">
            <div className="eyebrow">
              <span className="pulse-dot" /> About the initiative · Tumkur
            </div>
            <h1>
              Finding a blood donor
              <br />
              <em>shouldn't be this hard.</em>
            </h1>
            <p>
              HRS is putting together a local blood group directory, so that
              when someone in Tumkur urgently needs blood, there's an easy way
              to find people who might be able to help.
            </p>
          </div>
          <div className="about-goal-card motion-card">
            <span className="about-card-label">Our goal</span>
            <strong>
              1,000<span>+</span>
            </strong>
            <p>blood group records from people in and around Tumkur.</p>
            <div className="about-goal-rule">
              <span />
            </div>
          </div>
        </section>

        <section className="about-section about-intro-grid">
          <div className="about-section-heading">
            <span className="about-overline">01 · What is HRS</span>
            <h2
              className="about-scroll-reveal"
              aria-label="Humanitarian Relief Society (HRS) runs blood grouping camps and is building a donor directory for the Tumkur community."
            >
              <LetterReveal text="Humanitarian Relief Society (HRS) runs blood grouping camps and is building a donor directory for the Tumkur community." />
            </h2>
          </div>
          <div className="about-copy-stack">
            <p>
              When someone needs blood, finding a match can take longer than it
              should — even though plenty of people are willing to help, there's
              often no quick way to know who has the right blood group or how to
              reach them.
            </p>
            <p>
              HRS is trying to fix that by collecting blood group info and
              building an organised list of people who've agreed to be contacted
              if they're ever needed.
            </p>
          </div>
        </section>

        <section className="about-section about-process-section">
          <div className="about-section-heading about-wide-heading">
            <span className="about-overline">02 · How the process works</span>
            <h2 className="about-scroll-reveal" aria-label="How it works">
              <LetterReveal text="How it works" />
            </h2>
          </div>
          <ol className="about-timeline">
            {processSteps.map(({ title, copy, icon: Icon }, index) => (
              <li className="about-step about-scroll-reveal" key={title}>
                <div className="about-step-marker">
                  <Icon size={17} />
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="about-section about-consent-section">
          <div className="about-section-heading about-wide-heading">
            <span className="about-overline">03 · Two separate consents</span>
            <h2
              className="about-scroll-reveal"
              aria-label="Giving us your info and agreeing to donate blood are not the same thing."
            >
              <LetterReveal text="Giving us your info and agreeing to donate blood are not the same thing." />
            </h2>
            <p>
              We ask for two separate yeses, to make sure you always know
              exactly what you're agreeing to.
            </p>
          </div>
          <div className="about-consent-grid">
            <article className="about-consent-card about-scroll-reveal">
              <div className="about-consent-icon">
                <Database size={20} />
              </div>
              <span className="about-card-label">Consent 1</span>
              <h3>Store my info</h3>
              <p>
                You're okay with HRS collecting and keeping your details and
                blood group.
              </p>
            </article>
            <article className="about-consent-card about-consent-card-accent about-scroll-reveal">
              <div className="about-consent-icon">
                <HeartHandshake size={20} />
              </div>
              <span className="about-card-label">Consent 2</span>
              <h3>Contact me as a donor</h3>
              <p>
                You're separately okay with HRS reaching out later if your blood
                group is needed.
              </p>
            </article>
          </div>
          <div className="about-callout">
            <Check size={17} />
            <strong>
              Saying yes to the first doesn't mean you've agreed to the second.
            </strong>
          </div>
        </section>

        <section className="about-section about-privacy-grid">
          <div className="about-section-heading">
            <span className="about-overline">
              04 · How privacy is protected
            </span>
            <h2 className="about-scroll-reveal">
              <LetterReveal text="Useful public information. Private contact details." />
            </h2>
          </div>
          <div className="about-privacy-content">
            <div className="about-privacy-visual about-scroll-reveal">
              <EyeOff size={24} />
              <span>Private by design</span>
              <small>
                Private contact details are not displayed in the public
                directory.
              </small>
            </div>
            <div className="about-copy-stack about-scroll-reveal">
              <p>
                HRS may collect things like your phone number or email to run
                the initiative and reach out to donors — but none of that ever
                shows up publicly.
              </p>
              <p>
                <strong>What the public directory actually shows:</strong>
              </p>
              <div className="about-public-fields">
                <span>Name</span>
                <span>Age</span>
                <span>Gender</span>
                <span>Area / Address</span>
                <span>Blood Group</span>
              </div>
              <p>
                If someone needs help, they contact HRS — not the donor
                directly.
              </p>
            </div>
          </div>
        </section>

        <section className="about-section about-needed-section">
          <div className="about-section-heading about-wide-heading">
            <span className="about-overline">05 · When blood is needed</span>
            <h2
              className="about-scroll-reveal"
              aria-label="When blood is needed"
            >
              <LetterReveal text="When blood is needed" />
            </h2>
          </div>
          <div className="about-needed-grid">
            <div className="about-scroll-reveal">
              <span className="about-step-number">01</span>
              <h3>Search or reach out</h3>
              <p>
                Anyone can browse the directory by blood group and location, or
                just contact HRS if it's urgent.
              </p>
            </div>
            <div className="about-scroll-reveal">
              <span className="about-step-number">02</span>
              <h3>HRS reaches out to matching donors</h3>
              <p>Privately, based on the records available.</p>
            </div>
            <div className="about-scroll-reveal">
              <span className="about-step-number">03</span>
              <h3>The donor decides</h3>
              <p>
                Being on the list doesn't mean you have to say yes. Every time
                someone's contacted, it's still their choice.
              </p>
            </div>
          </div>
        </section>

        <section className="about-section about-after-section">
          <div className="about-section-heading">
            <span className="about-overline">06 · After you donate</span>
            <h2 className="about-scroll-reveal">
              <LetterReveal text="Donor records are updated when circumstances change." />
            </h2>
          </div>
          <p className="about-large-copy about-scroll-reveal">
            Once you've donated, HRS updates your record so you're not contacted
            again right away. After the standard waiting period, you'll show up
            as available again.
          </p>
        </section>

        <section className="about-section about-comparison-section">
          <div className="about-section-heading about-wide-heading">
            <span className="about-overline">
              07 · What this portal does — and doesn't do
            </span>
            <h2 className="about-scroll-reveal">
              <LetterReveal text="What this portal is here to do." />
            </h2>
          </div>
          <div className="about-comparison-grid">
            <article className="about-boundary-card about-scroll-reveal">
              <div className="about-boundary-heading">
                <Check size={17} />
                <h3>This portal does</h3>
              </div>
              <ul>
                {doesItems.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="about-boundary-card about-boundary-card-muted about-scroll-reveal">
              <div className="about-boundary-heading">
                <X size={17} />
                <h3>This portal does not</h3>
              </div>
              <ul>
                {doesNotItems.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="about-cta-section">
          <div>
            <h2>Need blood urgently?</h2>
            <p>
              Don't wait — call HRS and our volunteers will help you figure out
              the next step right away.
            </p>
          </div>
          <button
            className="primary-button about-cta-button"
            onClick={() => setEmergencyOpen(true)}
          >
            <PhoneCall size={17} /> Call HRS <ArrowRight size={17} />
          </button>
        </section>
      </main>

      <SiteFooter />
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <Link href="/">
          <House size={19} />
          <span>Home</span>
        </Link>
        <Link href="/#find">
          <Search size={20} />
          <span>Find Donors</span>
        </Link>
        <button
          className="emergency-tab"
          onClick={() => setEmergencyOpen(true)}
          aria-label="Open emergency help"
        >
          <span className="emergency-tab-icon">
            <PhoneCall size={22} />
          </span>
          <span>Emergency</span>
        </button>
        <Link href="/admin">
          <LockKeyhole size={19} />
          <span>Login</span>
        </Link>
      </nav>
      {emergencyOpen && (
        <EmergencyDropup requestDonor={null} onClose={closeEmergency} />
      )}
    </div>
  );
}
