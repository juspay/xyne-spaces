"""Curated Lens-safe ManimCE patterns for network and distributed-system explanations."""

from manim import *


def card(label, color=BLUE, width=1.7, height=0.68):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.1, color=color)
    text = Text(label, font_size=22, color=WHITE).move_to(box)
    return VGroup(box, text)


class DNSResolution(Scene):
    def construct(self):
        title = Text("DNS resolves a name through a chain of authority", font_size=28).to_edge(UP)
        nodes = VGroup(card("Browser", BLUE), card("Resolver", TEAL), card("Authority", ORANGE)).arrange(RIGHT, buff=0.85)
        query = Text("api.example.com?", font_size=22, color=YELLOW).next_to(nodes[0], DOWN)
        forward = VGroup(Arrow(nodes[0].get_right(), nodes[1].get_left(), buff=0.07), Arrow(nodes[1].get_right(), nodes[2].get_left(), buff=0.07))
        answer = Text("203.0.113.10", font_size=22, color=GREEN).next_to(nodes[1], UP)
        self.play(Write(title), FadeIn(nodes), FadeIn(query), Create(forward))
        self.play(FadeIn(answer), Indicate(nodes[1], color=YELLOW), Indicate(nodes[0], color=GREEN))


class TCPHandshake(Scene):
    def construct(self):
        title = Text("TCP agrees before sending application data", font_size=29).to_edge(UP)
        client, server = card("Client", BLUE), card("Server", GREEN)
        VGroup(client, server).arrange(RIGHT, buff=4.2).shift(DOWN * 0.2)
        messages = [("SYN", client, server, BLUE), ("SYN-ACK", server, client, GREEN), ("ACK", client, server, YELLOW)]
        self.play(Write(title), FadeIn(client), FadeIn(server))
        for label, source, target, color in messages:
            arrow = Arrow(source.get_top(), target.get_top(), buff=0.15, color=color)
            text = Text(label, font_size=22, color=color).next_to(arrow, UP)
            self.play(GrowArrow(arrow), FadeIn(text), run_time=0.45)
        self.play(Indicate(VGroup(client, server), color=YELLOW))


class RateLimiter(Scene):
    def construct(self):
        title = Text("A rate limiter spends a bounded budget", font_size=30).to_edge(UP)
        bucket = RoundedRectangle(width=4.5, height=1.2, corner_radius=0.18, color=TEAL).shift(DOWN * 0.35)
        tokens = VGroup(*[Dot(color=YELLOW, radius=0.13) for _ in range(7)]).arrange(RIGHT, buff=0.25).move_to(bucket)
        request = Arrow(LEFT * 5, bucket.get_left(), buff=0.08, color=BLUE)
        caption = Text("tokens available", font_size=23).next_to(bucket, UP)
        self.play(Write(title), Create(bucket), FadeIn(tokens), Write(caption))
        self.play(GrowArrow(request), FadeOut(tokens[-1]), FadeOut(tokens[-2]), Indicate(bucket, color=YELLOW))


class JobQueue(Scene):
    def construct(self):
        title = Text("A queue separates production from processing", font_size=29).to_edge(UP)
        producer, queue = card("Producer", BLUE), card("Queue", YELLOW)
        workers = VGroup(card("Worker 1", GREEN), card("Worker 2", GREEN)).arrange(DOWN, buff=0.35)
        producer.shift(LEFT * 3.5)
        queue.move_to(ORIGIN)
        workers.shift(RIGHT * 3.3)
        arrows = VGroup(Arrow(producer.get_right(), queue.get_left(), buff=0.08), *[Arrow(queue.get_right(), worker.get_left(), buff=0.08) for worker in workers])
        job = card("job", PURPLE, width=0.85, height=0.42).scale(0.75).next_to(producer, UP)
        self.play(Write(title), FadeIn(producer), FadeIn(queue), FadeIn(workers), Create(arrows), FadeIn(job))
        self.play(job.animate.next_to(queue, UP), run_time=0.45)
        self.play(job.animate.next_to(workers[0], UP), run_time=0.45)


class EventPipeline(Scene):
    def construct(self):
        title = Text("Events carry facts to independent consumers", font_size=29).to_edge(UP)
        producer = card("Checkout", BLUE).shift(LEFT * 3.6)
        topic = card("order.created", PURPLE, width=2.1)
        consumers = VGroup(card("Email", GREEN), card("Analytics", ORANGE)).arrange(DOWN, buff=0.4).shift(RIGHT * 3.3)
        arrows = VGroup(Arrow(producer.get_right(), topic.get_left(), buff=0.08), *[Arrow(topic.get_right(), consumer.get_left(), buff=0.08) for consumer in consumers])
        self.play(Write(title), FadeIn(producer), FadeIn(topic), FadeIn(consumers), Create(arrows))
        self.play(LaggedStart(*[Indicate(consumer, color=YELLOW) for consumer in consumers], lag_ratio=0.2))
