package com.finsight;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication(exclude = org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration.class)
public class FinSightApplication {
    public static void main(String[] args) { SpringApplication.run(FinSightApplication.class, args); }
}
