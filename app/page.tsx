import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import AIProjects from "@/components/AIProjects";
import Experience from "@/components/Experience";
import Skills from "@/components/Skills";
import Education from "@/components/Education";
import Contact from "@/components/Contact";

export default function ResumePage() {
  return (
    <>
      <Navbar />
      <Hero />
      <AIProjects />
      <Experience />
      <Skills />
      <Education />
      <Contact />
      <a href="https://1milliontaps.lol/r/4309" target="_blank" rel="noopener nofollow"><img src="https://1milliontaps.lol/badge/4309.svg" alt="Live on 1milliontaps.lol" width="268" height="56" /></a>
    </>
  );
}
