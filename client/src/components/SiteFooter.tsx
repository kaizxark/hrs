import { Link } from "wouter";

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <img
        src="/hrs-logo.png"
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          borderRadius: "inherit",
        }}
      />
    </div>
  );
}

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-intro">
          <Link className="brand footer-brand" href="/">
            <LogoMark />
            <span>
              <strong>HRS</strong>
              <small>Humanitarian Relief Society</small>
            </span>
          </Link>
          <p>
            We're building a local blood donor network for Tumkur — making it
            easier to find potential donors quickly, while keeping everyone's
            personal details private and secure.
          </p>
        </div>
        <div className="footer-column">
          <strong>Explore</strong>
          <Link href="/#find">Find Donors</Link>
          <Link href="/about">About the Initiative</Link>
          <a href="#faq">FAQ</a>
        </div>
        <div className="footer-column">
          <strong>Support &amp; Information</strong>
          <a href="#privacy">Privacy &amp; Consent</a>
          <a href="#feedback">Feedback</a>
          <a href="#contact">Contact HRS</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Humanitarian Relief Society. All rights reserved.</span>
        <span>Made for the people of Tumkur.</span>
      </div>
    </footer>
  );
}
