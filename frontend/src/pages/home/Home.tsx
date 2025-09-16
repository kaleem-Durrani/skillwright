import { useEffect, useRef, useState } from "react";
import { Typography, Button, Row, Col, Card, Form, Input, message } from "antd";
import {
  ArrowDownOutlined,
  SendOutlined,
  PhoneOutlined,
  MailOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";

// Import local images
import mainHomeImage from "@/assets/main-home.jpeg";
import about1Image from "@/assets/about1.jpeg";
import about2Image from "@/assets/about2.jpeg";
import about3Image from "@/assets/about3.jpeg";
import whyChooseUsImage from "@/assets/why-choose-us.jpeg";

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

const Home = () => {
  // Refs for scrolling to sections
  const homeRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);

  // State for section visibility
  const [aboutVisible, setAboutVisible] = useState(false);
  const [contactVisible, setContactVisible] = useState(false);

  // Handle hash changes for direct links
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === "#about" && aboutRef.current) {
        aboutRef.current.scrollIntoView({ behavior: "smooth" });
      } else if (hash === "#contact" && contactRef.current) {
        contactRef.current.scrollIntoView({ behavior: "smooth" });
      } else if (hash === "#home" && homeRef.current) {
        homeRef.current.scrollIntoView({ behavior: "smooth" });
      }
    };

    // Check hash on initial load
    handleHashChange();

    // Add event listener for hash changes
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Set up intersection observer for scroll animations
  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: "0px",
      threshold: 0.1,
    };

    const aboutObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setAboutVisible(true);
        } else {
          setAboutVisible(false);
        }
      });
    }, observerOptions);

    const contactObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setContactVisible(true);
        } else {
          setContactVisible(false);
        }
      });
    }, observerOptions);

    if (aboutRef.current) {
      aboutObserver.observe(aboutRef.current);
    }

    if (contactRef.current) {
      contactObserver.observe(contactRef.current);
    }

    return () => {
      if (aboutRef.current) {
        aboutObserver.unobserve(aboutRef.current);
      }
      if (contactRef.current) {
        contactObserver.unobserve(contactRef.current);
      }
    };
  }, []);

  // Form submission handler
  const onFinish = (values: any) => {
    console.log("Form values:", values);
    message.success("Thank you for your message! We'll get back to you soon.");
  };

  return (
    <div className="landing-page">
      {/* Hero Section */}
      <section
        ref={homeRef}
        id="home"
        className="min-h-screen flex flex-col items-center justify-center relative bg-gradient-to-b from-blue-500 to-purple-600 text-white p-4"
      >
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${mainHomeImage})` }}
        ></div>
        <div className="container mx-auto text-center relative z-10 max-w-4xl">
          <Title className="text-5xl md:text-7xl font-bold mb-6 text-white fade-in">
            Millat Vocational Training
          </Title>
          <Paragraph className="text-xl md:text-2xl mb-8 text-white fade-in-delay-1">
            Empowering futures through quality education and practical skills
            training
          </Paragraph>
          <div className="flex flex-col sm:flex-row gap-4 justify-center fade-in-delay-2">
            <Button
              type="primary"
              size="large"
              onClick={() =>
                aboutRef.current?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Learn More
            </Button>
            <Button
              type="default"
              size="large"
              className="transparent"
              href="/register"
            >
              Get Started
            </Button>
          </div>
        </div>
        <div className="absolute bottom-10 animate-bounce fade-in-delay-3">
          <ArrowDownOutlined
            className="text-3xl text-white cursor-pointer"
            onClick={() =>
              aboutRef.current?.scrollIntoView({ behavior: "smooth" })
            }
          />
        </div>
      </section>

      {/* About Section */}
      <section
        ref={aboutRef}
        id="about"
        className="min-h-screen py-20 bg-gray-50"
      >
        <div className="container mx-auto px-4">
          <Title
            level={2}
            className={`text-center mb-16 text-4xl ${
              aboutVisible ? "fade-in" : "opacity-0"
            }`}
          >
            About Our Institution
          </Title>

          <Row gutter={[32, 32]} className="mb-16">
            <Col
              xs={24}
              md={8}
              className={aboutVisible ? "fade-in" : "opacity-0"}
            >
              <Card
                className="h-full shadow-md hover:shadow-lg transition-shadow"
                cover={
                  <div className="h-48 relative overflow-hidden">
                    <img
                      src={about1Image}
                      alt="Our Mission"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 right-4 text-4xl">🎓</div>
                  </div>
                }
              >
                <Title level={3}>Our Mission</Title>
                <Paragraph>
                  To provide accessible, quality vocational education that
                  empowers individuals with practical skills needed for
                  successful careers in today's dynamic job market.
                </Paragraph>
              </Card>
            </Col>
            <Col
              xs={24}
              md={8}
              className={aboutVisible ? "fade-in-delay-1" : "opacity-0"}
            >
              <Card
                className="h-full shadow-md hover:shadow-lg transition-shadow"
                cover={
                  <div className="h-48 relative overflow-hidden">
                    <img
                      src={about2Image}
                      alt="Our Vision"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 right-4 text-4xl">🌟</div>
                  </div>
                }
              >
                <Title level={3}>Our Vision</Title>
                <Paragraph>
                  To be the leading vocational training institution, recognized
                  for excellence in education, innovation, and producing skilled
                  professionals who contribute positively to society.
                </Paragraph>
              </Card>
            </Col>
            <Col
              xs={24}
              md={8}
              className={aboutVisible ? "fade-in-delay-2" : "opacity-0"}
            >
              <Card
                className="h-full shadow-md hover:shadow-lg transition-shadow"
                cover={
                  <div className="h-48 relative overflow-hidden">
                    <img
                      src={about3Image}
                      alt="Our Values"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 right-4 text-4xl">🌱</div>
                  </div>
                }
              >
                <Title level={3}>Our Values</Title>
                <Paragraph>
                  Excellence, integrity, innovation, inclusivity, and practical
                  learning form the foundation of our educational approach and
                  institutional culture.
                </Paragraph>
              </Card>
            </Col>
          </Row>

          <div
            className={`bg-white p-8 rounded-lg shadow-md ${
              aboutVisible ? "fade-in-delay-3" : "opacity-0"
            }`}
          >
            <Row gutter={[32, 32]} align="middle">
              <Col xs={24} lg={12}>
                <div className="aspect-video bg-gray-200 rounded-lg overflow-hidden">
                  <img
                    src={whyChooseUsImage}
                    alt="Why Choose Us"
                    className="w-full h-full object-cover"
                  />
                </div>
              </Col>
              <Col xs={24} lg={12}>
                <Title level={3}>Why Choose Us?</Title>
                <Paragraph className="text-lg">
                  At Millat Vocational Training, we offer:
                </Paragraph>
                <ul className="list-disc pl-5 mb-4">
                  <li className="mb-2">
                    Industry-relevant curriculum designed by experts
                  </li>
                  <li className="mb-2">
                    Hands-on practical training with modern equipment
                  </li>
                  <li className="mb-2">
                    Experienced faculty with real-world expertise
                  </li>
                  <li className="mb-2">
                    Flexible learning options to suit your schedule
                  </li>
                  <li className="mb-2">
                    Career guidance and placement assistance
                  </li>
                </ul>
                <Button
                  type="primary"
                  size="large"
                  className="mt-4"
                  href="/explore-courses"
                >
                  Explore Our Courses
                </Button>
              </Col>
            </Row>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section
        ref={contactRef}
        id="contact"
        className="min-h-screen py-20 bg-gradient-to-br from-blue-50 to-purple-50"
      >
        <div className="container mx-auto px-4">
          <Title
            level={2}
            className={`text-center mb-16 text-4xl ${
              contactVisible ? "fade-in" : "opacity-0"
            }`}
          >
            Get In Touch
          </Title>

          <Row gutter={[32, 32]}>
            <Col
              xs={24}
              lg={12}
              className={contactVisible ? "fade-in" : "opacity-0"}
            >
              <div className="bg-white p-8 rounded-lg shadow-md h-full">
                <Title level={3} className="mb-6">
                  Contact Information
                </Title>

                <div className="mb-6 flex items-start">
                  <PhoneOutlined className="text-2xl text-blue-500 mr-4 mt-1" />
                  <div>
                    <Text strong className="block mb-1 text-lg">
                      Phone
                    </Text>
                    <Paragraph className="text-gray-600">
                      +92 123 456 7890
                    </Paragraph>
                  </div>
                </div>

                <div className="mb-6 flex items-start">
                  <MailOutlined className="text-2xl text-blue-500 mr-4 mt-1" />
                  <div>
                    <Text strong className="block mb-1 text-lg">
                      Email
                    </Text>
                    <Paragraph className="text-gray-600">
                      info@millatvocational.edu
                    </Paragraph>
                  </div>
                </div>

                <div className="mb-6 flex items-start">
                  <EnvironmentOutlined className="text-2xl text-blue-500 mr-4 mt-1" />
                  <div>
                    <Text strong className="block mb-1 text-lg">
                      Address
                    </Text>
                    <Paragraph className="text-gray-600">
                      123 Education Street, Knowledge City
                      <br />
                      Pakistan
                    </Paragraph>
                  </div>
                </div>

                <div className="mt-8">
                  <Title level={4} className="mb-4">
                    Office Hours
                  </Title>
                  <Paragraph className="text-gray-600">
                    <strong>Monday - Friday:</strong> 9:00 AM - 5:00 PM
                    <br />
                    <strong>Saturday:</strong> 9:00 AM - 1:00 PM
                    <br />
                    <strong>Sunday:</strong> Closed
                  </Paragraph>
                </div>
              </div>
            </Col>

            {/* Send Message Form - Commented Out */}
            {/* <Col
              xs={24}
              lg={12}
              className={contactVisible ? "fade-in-delay-1" : "opacity-0"}
            >
              <div className="bg-white p-8 rounded-lg shadow-md">
                <Title level={3} className="mb-6">
                  Send Us a Message
                </Title>

                {/* <Form layout="vertical" onFinish={onFinish}>
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="name"
                        label="Full Name"
                        rules={[
                          { required: true, message: "Please enter your name" },
                        ]}
                      >
                        <Input size="large" placeholder="Your name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="email"
                        label="Email"
                        rules={[
                          {
                            required: true,
                            message: "Please enter your email",
                          },
                          {
                            type: "email",
                            message: "Please enter a valid email",
                          },
                        ]}
                      >
                        <Input size="large" placeholder="Your email" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item
                    name="subject"
                    label="Subject"
                    rules={[
                      { required: true, message: "Please enter a subject" },
                    ]}
                  >
                    <Input size="large" placeholder="What is this regarding?" />
                  </Form.Item>

                  <Form.Item
                    name="message"
                    label="Message"
                    rules={[
                      { required: true, message: "Please enter your message" },
                    ]}
                  >
                    <TextArea
                      rows={6}
                      placeholder="How can we help you?"
                      className="resize-none"
                    />
                  </Form.Item>

                  <Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      size="large"
                      icon={<SendOutlined />}
                      className="w-full"
                    >
                      Send Message
                    </Button>
                  </Form.Item>
                </Form> */}
            {/* </div> */}
            {/* </Col> */}
          </Row>
        </div>
      </section>
    </div>
  );
};

export default Home;
